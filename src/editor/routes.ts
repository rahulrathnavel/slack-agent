import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import type { Application, Request, Response } from "express";
import express from "express";
import type { WebClient } from "@slack/web-api";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { NvidiaClient } from "../services/nvidia.js";
import type { DeckPlan, DeckRequest } from "../types.js";
import { readJsonFile } from "../storage/files.js";
import { renderEditorPage } from "./page.js";
import { isValidEditorToken } from "./security.js";

const MAX_HTML_BYTES = 1_500_000;
const DECK_ID_PATTERN = /^\d+-[A-Za-z0-9_-]+$/;

interface DeckManifest {
  publicUrl: string;
  plan: DeckPlan;
  request: DeckRequest;
}

export function mountEditorRoutes(app: Application, slackClient: WebClient, nvidia = new NvidiaClient()): void {
  app.get("/editor/:deckId", (req, res) => {
    const deckId = safeDeckId(req.params.deckId);
    if (!deckId) {
      res.status(404).send("Deck not found");
      return;
    }
    res.type("html").send(renderEditorPage(deckId));
  });

  const api = express.Router();
  api.use(express.json({ limit: "2mb" }));
  api.use("/:deckId", (req, res, next) => {
    const deckId = safeDeckId(req.params.deckId);
    const token = editorTokenFromRequest(req);
    if (!deckId || !token || !isValidEditorToken(deckId, token)) {
      res.status(401).json({ error: "This editor link is invalid or expired." });
      return;
    }
    res.locals.deckId = deckId;
    next();
  });

  api.get("/:deckId/source", async (_req, res) => {
    try {
      const deckId = res.locals.deckId as string;
      const draftPath = draftFile(deckId);
      const livePath = deckFile(deckId, "index.html");
      let isDraft = true;
      let html: string;
      try {
        html = await fs.readFile(draftPath, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        html = await fs.readFile(livePath, "utf8");
        isDraft = false;
      }
      const manifest = await readManifest(deckId);
      res.json({ html, isDraft, publicUrl: manifest.publicUrl, title: manifest.plan.title });
    } catch (error) {
      sendEditorError(res, error);
    }
  });

  api.post("/:deckId/save", async (req, res) => {
    try {
      const deckId = res.locals.deckId as string;
      const html = validatedHtml(req.body?.html);
      await fs.writeFile(draftFile(deckId), html, "utf8");
      res.json({ ok: true });
    } catch (error) {
      sendEditorError(res, error);
    }
  });

  api.post("/:deckId/ai", async (req, res) => {
    try {
      const html = validatedHtml(req.body?.html);
      const instruction = String(req.body?.instruction ?? "").trim().slice(0, 4_000);
      if (!instruction) throw new EditorInputError("Add an editing instruction.");
      const result = (await applyFastHtmlEdit(html, instruction)) ?? (await editDeckHtml(nvidia, html, instruction));
      res.json(result);
    } catch (error) {
      sendEditorError(res, error);
    }
  });

  api.post("/:deckId/upload", express.raw({ type: "image/*", limit: "8mb" }), async (req, res) => {
    try {
      const deckId = res.locals.deckId as string;
      const mime = String(req.header("content-type") ?? "").split(";")[0]!.toLowerCase();
      const extension = imageExtension(mime);
      if (!extension || !Buffer.isBuffer(req.body) || !req.body.length) {
        throw new EditorInputError("Choose a PNG, JPEG, WebP, GIF, or AVIF image.");
      }
      const assetsDir = path.join(config.decksDir, deckId, "assets");
      const filename = `${nanoid(14)}.${extension}`;
      await fs.mkdir(assetsDir, { recursive: true });
      await fs.writeFile(path.join(assetsDir, filename), req.body);
      res.json({ url: `/decks/${encodeURIComponent(deckId)}/assets/${filename}` });
    } catch (error) {
      sendEditorError(res, error);
    }
  });

  api.post("/:deckId/publish", async (req, res) => {
    try {
      const deckId = res.locals.deckId as string;
      const html = validatedHtml(req.body?.html);
      const manifest = await readManifest(deckId);
      await backupPublishedDeck(deckId);
      await fs.writeFile(deckFile(deckId, "index.html"), html, "utf8");
      await fs.writeFile(draftFile(deckId), html, "utf8");
      const title = extractDeckTitle(html, manifest.plan.title);
      const notified = await notifySlack(slackClient, manifest, title);
      res.json({ ok: true, title, publicUrl: manifest.publicUrl, notified });
    } catch (error) {
      sendEditorError(res, error);
    }
  });

  app.use("/api/editor", api);
}

async function backupPublishedDeck(deckId: string): Promise<void> {
  try {
    const current = await fs.readFile(deckFile(deckId, "index.html"), "utf8");
    const revisionDir = path.join(config.editorRevisionsDir, deckId);
    await fs.mkdir(revisionDir, { recursive: true });
    await fs.writeFile(path.join(revisionDir, `${Date.now()}.html`), current, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function imageExtension(mime: string): string | undefined {
  return {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif"
  }[mime];
}

async function editDeckHtml(
  nvidia: NvidiaClient,
  html: string,
  instruction: string
): Promise<{ html: string; summary: string }> {
  const output = await nvidia.chatText(
    [
      {
        role: "system",
        content: `You are the PioltPPT deck editor. Apply only the requested change to a complete presentation HTML document.
Return the complete updated HTML and nothing else.
Preserve navigation, keyboard controls, responsive layout, print styles, source panel, and existing content unless the request changes them.
Never add placeholder copy or visible editing instructions.
Never invent an image URL. Add an image only when the user supplies its URL.
Keep slide text concise and presentation-ready.
Do not wrap the result in Markdown fences.`
      },
      {
        role: "user",
        content: `Editing instruction:\n${instruction}\n\nCurrent HTML:\n${html}`
      }
    ],
    { model: config.NVIDIA_MODEL_PRIMARY, temperature: 0.15, maxTokens: 16_000 }
  );
  const updated = validatedHtml(extractHtml(output));
  return { html: updated, summary: "The requested change is ready in the preview." };
}

async function applyFastHtmlEdit(html: string, instruction: string): Promise<{ html: string; summary: string } | undefined> {
  const index = inferSlideIndex(html, instruction);
  if (index === undefined) return undefined;

  let nextHtml = html;
  const summaries: string[] = [];
  const lower = instruction.toLowerCase();

  if (/\bimage\b/.test(lower) && /\bright\b/.test(lower)) {
    const changed = updateSlide(nextHtml, index, moveSlideImage("right"));
    if (!changed) return undefined;
    nextHtml = changed;
    summaries.push(`Moved slide ${index + 1} image to the right.`);
  } else if (/\bimage\b/.test(lower) && /\bleft\b/.test(lower)) {
    const changed = updateSlide(nextHtml, index, moveSlideImage("left"));
    if (!changed) return undefined;
    nextHtml = changed;
    summaries.push(`Moved slide ${index + 1} image to the left.`);
  } else if (/\bimage\b/.test(lower) && /\bbackground\b/.test(lower)) {
    const changed = updateSlide(nextHtml, index, moveSlideImage("background"));
    if (!changed) return undefined;
    nextHtml = changed;
    summaries.push(`Changed slide ${index + 1} image to background placement.`);
  } else if (/\bimage\b/.test(lower) && /\bfull\b/.test(lower)) {
    const changed = updateSlide(nextHtml, index, moveSlideImage("full"));
    if (!changed) return undefined;
    nextHtml = changed;
    summaries.push(`Changed slide ${index + 1} image to full-width placement.`);
  }

  if (/(single|one)\s+(point|bullet)|one\s+single\s+point|single\s+point\s+alone/.test(lower)) {
    const changed = updateSlide(nextHtml, index, keepFirstBulletOnly);
    if (!changed) return undefined;
    nextHtml = changed;
    summaries.push(`Kept one main point on slide ${index + 1}.`);
  }

  if (!summaries.length || nextHtml === html) return undefined;
  return { html: validatedHtml(nextHtml), summary: summaries.join(" ") };
}

function inferSlideIndex(html: string, instruction: string): number | undefined {
  const slideNumber = instruction.match(/\bslide\s*(\d+)\b/i)?.[1];
  if (slideNumber) {
    const index = Number(slideNumber) - 1;
    return Number.isInteger(index) && index >= 0 ? index : undefined;
  }
  if (!/\bimage\b/i.test(instruction)) return undefined;
  const matches = [...html.matchAll(/<article\b[^>]*class="[^"]*\bslide\b[^"]*"[^>]*>[\s\S]*?<\/article>/gi)];
  const firstVisualIndex = matches.findIndex((match) => /<figure\b[^>]*class="[^"]*\bvisual\b/i.test(match[0]));
  return firstVisualIndex >= 0 ? firstVisualIndex : undefined;
}

function updateSlide(html: string, index: number, edit: (slideHtml: string) => string | undefined): string | undefined {
  const matches = [...html.matchAll(/<article\b[^>]*class="[^"]*\bslide\b[^"]*"[^>]*>[\s\S]*?<\/article>/gi)];
  const match = matches[index];
  if (!match || match.index === undefined) return undefined;
  const replacement = edit(match[0]);
  if (!replacement || replacement === match[0]) return undefined;
  return `${html.slice(0, match.index)}${replacement}${html.slice(match.index + match[0].length)}`;
}

function moveSlideImage(placement: "right" | "left" | "background" | "full"): (slideHtml: string) => string | undefined {
  return (slideHtml) => {
    if (!/<figure\b[^>]*class="[^"]*\bvisual\b/i.test(slideHtml)) return undefined;
    const visualClass = placement === "right" ? "visual-right" : `visual-${placement}`;
    return slideHtml.replace(/<article\b([^>]*)class="([^"]*)"([^>]*)>/i, (_full, before, classValue: string, after) => {
      const classes = classValue
        .split(/\s+/)
        .filter((name) => name && !["visual-left", "visual-right", "visual-background", "visual-full"].includes(name));
      if (!classes.includes("has-visual")) classes.push("has-visual");
      classes.push(visualClass);
      return `<article${before}class="${classes.join(" ")}"${after}>`;
    });
  };
}

function keepFirstBulletOnly(slideHtml: string): string | undefined {
  const list = slideHtml.match(/<ul\b[^>]*class="[^"]*\bbullets\b[^"]*"[^>]*>([\s\S]*?)<\/ul>/i);
  const listMarkup = list?.[0];
  const listInner = list?.[1];
  if (!listMarkup || !listInner) return undefined;
  const firstBullet = listInner.match(/<li\b[^>]*>[\s\S]*?<\/li>/i)?.[0];
  if (!firstBullet) return undefined;
  const nextList = listMarkup.replace(listInner, firstBullet);
  return slideHtml.replace(listMarkup, nextList);
}
async function notifySlack(client: WebClient, manifest: DeckManifest, title: string): Promise<boolean> {
  try {
    let channel = manifest.request.channelId;
    if (!channel && manifest.request.requesterUserId) {
      const opened = await client.conversations.open({ users: manifest.request.requesterUserId });
      channel = opened.channel?.id;
    }
    if (!channel) return false;
    await client.chat.postMessage({
      channel,
      thread_ts: manifest.request.threadTs,
      text: `${title} was updated in Deck Playground: ${manifest.publicUrl}`,
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: `*${title}* was updated in Deck Playground.` }
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "Open finished deck" },
              url: manifest.publicUrl,
              action_id: "open_finished_editor_deck"
            }
          ]
        }
      ]
    });
    return true;
  } catch (error) {
    logger.warn({ error }, "Deck published but Slack notification failed");
    return false;
  }
}

async function readManifest(deckId: string): Promise<DeckManifest> {
  const manifest = await readJsonFile<DeckManifest>(deckFile(deckId, "deck.json"));
  if (!manifest) throw new EditorInputError("Deck not found.", 404);
  return manifest;
}

function deckFile(deckId: string, filename: "index.html" | "deck.json"): string {
  return path.join(config.decksDir, deckId, filename);
}

function draftFile(deckId: string): string {
  return path.join(config.editorDraftsDir, `${deckId}.html`);
}

function safeDeckId(value: string | string[] | undefined): string | undefined {
  const deckId = Array.isArray(value) ? value[0] : value;
  return deckId && DECK_ID_PATTERN.test(deckId) ? deckId : undefined;
}

function editorTokenFromRequest(req: Request): string | undefined {
  const queryToken = req.query.token;
  if (typeof queryToken === "string" && queryToken) {
    return queryToken;
  }
  const value = req.header("authorization");
  return value?.match(/^Bearer\s+(.+)$/i)?.[1];
}

export function validatedHtml(value: unknown): string {
  if (typeof value !== "string") throw new EditorInputError("The deck HTML is missing.");
  const html = value.trim();
  if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) throw new EditorInputError("The deck HTML is too large.");
  if (!/^<!doctype html>/i.test(html) || !/<html[\s>]/i.test(html) || !/<body[\s>]/i.test(html)) {
    throw new EditorInputError("Keep the complete HTML document, including doctype, html, and body elements.");
  }
  return html;
}

export function extractHtml(value: string): string {
  const fenced = value.match(/```(?:html)?\s*([\s\S]*?)\s*```/i)?.[1];
  const candidate = (fenced ?? value).trim();
  const start = candidate.search(/<!doctype html>/i);
  const end = candidate.toLowerCase().lastIndexOf("</html>");
  return start >= 0 && end >= start ? candidate.slice(start, end + 7) : candidate;
}

export function extractDeckTitle(html: string, fallback: string): string {
  const heading = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const text = heading?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text || fallback;
}

function sendEditorError(res: Response, error: unknown): void {
  if (error instanceof EditorInputError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if ((error as NodeJS.ErrnoException).code === "ENOENT") {
    res.status(404).json({ error: "Deck not found." });
    return;
  }
  logger.error({ error }, "Deck editor request failed");
  res.status(500).json({ error: "The editor could not complete that request." });
}

class EditorInputError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

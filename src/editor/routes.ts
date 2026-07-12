import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import type { Application, Request, Response } from "express";
import express from "express";
import type { WebClient } from "@slack/web-api";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { extractJson, NvidiaClient } from "../services/nvidia.js";
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
  const slideBlocks = extractSlideBlocks(html);
  const targetIndexes = inferTargetSlideIndexes(html, instruction);
  if (slideBlocks.length && targetIndexes.length) {
    return editTargetedSlides(nvidia, html, instruction, targetIndexes);
  }

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

async function editTargetedSlides(
  nvidia: NvidiaClient,
  html: string,
  instruction: string,
  targetIndexes: number[]
): Promise<{ html: string; summary: string }> {
  const slideBlocks = extractSlideBlocks(html);
  const targetSlides = targetIndexes
    .map((index) => slideBlocks[index])
    .filter((slide): slide is SlideBlock => Boolean(slide));
  if (!targetSlides.length) throw new EditorInputError("I could not find the requested slide.");

  const slidePayload = targetSlides
    .map((slide) => `SLIDE ${slide.index + 1}\n${slide.html}`)
    .join("\n\n---\n\n");
  const output = await nvidia.chatText(
    [
      {
        role: "system",
        content: `You are the PioltPPT slide editor. Edit only the supplied slide article blocks.
Return strict JSON only:
{"slides":[{"slideNumber":2,"html":"<article class=\\"slide ...\\">...</article>"}],"summary":"short user-facing summary"}
Rules:
- Return complete <article> blocks only, not full HTML documents.
- Preserve slide class names, data attributes, keyboard/nav mechanics, and existing visual CSS class conventions.
- Do not include <html>, <head>, <body>, <style>, or <script>.
- Keep content concise, professional, and presentation-ready.
- If adding an image URL supplied by the user, use the exact URL from the instruction.
- For requested right-side images, make the returned article resistant to narrow preview panes by adding inline layout on the article:
  style="grid-template-columns: minmax(0, 1fr) minmax(220px, .48fr); grid-template-rows: minmax(0, 1fr); align-items: center;"
- For requested right-side images, use:
  <figure class="visual visual-contain" style="height: min(46vh, 390px); max-height: 390px; align-self: center;"><img src="URL" alt="descriptive alt" loading="lazy" style="width: 100%; height: 100%; object-fit: contain; object-position: center; padding: clamp(14px, 3vw, 36px); background: #fff;" /></figure>
- If text plus image cannot fit well, reduce bullets to the strongest 1-2 points before returning the article.
- Never invent image URLs.`
      },
      {
        role: "user",
        content: `Editing instruction:\n${instruction}\n\nCurrent slide blocks:\n${slidePayload}`
      }
    ],
    { model: config.NVIDIA_MODEL_FAST, temperature: 0.12, maxTokens: 6_000 }
  );
  const patch = parseSlidePatch(output);
  const replacements = new Map<number, string>();
  for (const item of patch.slides) {
    const index = item.slideNumber - 1;
    if (!targetIndexes.includes(index)) continue;
    replacements.set(index, normalizeReturnedSlideArticle(validatedArticleHtml(item.html), instruction));
  }
  if (!replacements.size) {
    throw new EditorInputError("The AI response did not include an updated slide block.");
  }
  return {
    html: validatedHtml(replaceSlideBlocks(html, replacements)),
    summary: patch.summary || `Updated slide ${targetSlides.map((slide) => slide.index + 1).join(", ")}.`
  };
}

async function applyFastHtmlEdit(html: string, instruction: string): Promise<{ html: string; summary: string } | undefined> {
  const index = inferSlideIndex(html, instruction);
  if (index === undefined) return undefined;

  let nextHtml = html;
  const summaries: string[] = [];
  const lower = instruction.toLowerCase();
  const imageUrls = extractImageUrls(instruction);
  if (imageUrls.length) return undefined;

  if (/\bimage\b/.test(lower) && /\b(fit|contain|fully visible|visible|uncrop|not crop|no crop)\b/.test(lower)) {
    const changed = updateSlide(nextHtml, index, containSlideImage);
    if (!changed) return undefined;
    nextHtml = changed;
    summaries.push(`Sized slide ${index + 1} image to stay fully visible.`);
  }

  if (!imageUrls.length && /\bimage\b/.test(lower) && /\bright\b/.test(lower)) {
    const changed = updateSlide(nextHtml, index, moveSlideImage("right"));
    if (!changed) return undefined;
    nextHtml = changed;
    summaries.push(`Moved slide ${index + 1} image to the right.`);
  } else if (!imageUrls.length && /\bimage\b/.test(lower) && /\bleft\b/.test(lower)) {
    const changed = updateSlide(nextHtml, index, moveSlideImage("left"));
    if (!changed) return undefined;
    nextHtml = changed;
    summaries.push(`Moved slide ${index + 1} image to the left.`);
  } else if (!imageUrls.length && /\bimage\b/.test(lower) && /\bbackground\b/.test(lower)) {
    const changed = updateSlide(nextHtml, index, moveSlideImage("background"));
    if (!changed) return undefined;
    nextHtml = changed;
    summaries.push(`Changed slide ${index + 1} image to background placement.`);
  } else if (!imageUrls.length && /\bimage\b/.test(lower) && /\bfull\b/.test(lower)) {
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
  const slideNumber = instruction.match(/\bslide\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i)?.[1];
  if (slideNumber) {
    const index = slideNumberToIndex(slideNumber);
    return Number.isInteger(index) && index >= 0 ? index : undefined;
  }
  if (!/\bimage\b/i.test(instruction)) return undefined;
  const matches = [...html.matchAll(/<article\b[^>]*class="[^"]*\bslide\b[^"]*"[^>]*>[\s\S]*?<\/article>/gi)];
  const firstVisualIndex = matches.findIndex((match) => /<figure\b[^>]*class="[^"]*\bvisual\b/i.test(match[0]));
  return firstVisualIndex >= 0 ? firstVisualIndex : undefined;
}

function updateSlide(html: string, index: number, edit: (slideHtml: string) => string | undefined): string | undefined {
  const block = extractSlideBlocks(html)[index];
  if (!block) return undefined;
  const replacement = edit(block.html);
  if (!replacement || replacement === block.html) return undefined;
  return `${html.slice(0, block.start)}${replacement}${html.slice(block.end)}`;
}

function replaceSlideBlocks(html: string, replacements: Map<number, string>): string {
  const blocks = extractSlideBlocks(html);
  let nextHtml = html;
  for (const [index, replacement] of [...replacements.entries()].sort((a, b) => b[0] - a[0])) {
    const block = blocks[index];
    if (block) {
      nextHtml = `${nextHtml.slice(0, block.start)}${replacement}${nextHtml.slice(block.end)}`;
    }
  }
  return nextHtml;
}

interface SlideBlock {
  index: number;
  start: number;
  end: number;
  html: string;
}

function extractSlideBlocks(html: string): SlideBlock[] {
  return [...html.matchAll(/<article\b[^>]*class="[^"]*\bslide\b[^"]*"[^>]*>[\s\S]*?<\/article>/gi)].map(
    (match, index) => ({
      index,
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      html: match[0]
    })
  );
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

function containSlideImage(slideHtml: string): string | undefined {
  if (!/<figure\b[^>]*class="[^"]*\bvisual\b/i.test(slideHtml)) return undefined;
  let nextHtml = slideHtml.replace(/<figure\b([^>]*)class="([^"]*\bvisual\b[^"]*)"([^>]*)>/i, (_full, before, classValue: string, after) => {
    const classes = classValue.split(/\s+/).filter(Boolean);
    if (!classes.includes("visual-contain")) classes.push("visual-contain");
    return `<figure${before}class="${classes.join(" ")}"${after}>`;
  });
  nextHtml = nextHtml.replace(/<img\b([^>]*)>/i, (full, attrs: string) => {
    const withoutStyle = attrs.replace(/\sstyle=(?:"[^"]*"|'[^']*')/i, "");
    return `<img${withoutStyle} style="${containImageStyle()}">`;
  });
  return nextHtml;
}

function inferTargetSlideIndexes(html: string, instruction: string): number[] {
  const blocks = extractSlideBlocks(html);
  const indexes = new Set<number>();
  const slidePhrase = /\bslides?\s+((?:(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:\s*(?:,|and|&|to|-)\s*)?)+)/gi;
  for (const match of instruction.matchAll(slidePhrase)) {
    const phrase = match[1] ?? "";
    const values = [...phrase.matchAll(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/gi)]
      .map((value) => slideNumberToIndex(value[1] ?? ""));
    for (const value of values) {
      if (value >= 0 && value < blocks.length) indexes.add(value);
    }
  }
  if (!indexes.size && /\ball\s+slides\b/i.test(instruction)) {
    blocks.forEach((block) => indexes.add(block.index));
  }
  return [...indexes].sort((a, b) => a - b);
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

interface SlidePatch {
  slides: { slideNumber: number; html: string }[];
  summary?: string;
}

function parseSlidePatch(output: string): SlidePatch {
  const parsed = JSON.parse(extractJson(output)) as Partial<SlidePatch>;
  if (!Array.isArray(parsed.slides)) {
    throw new EditorInputError("The AI response did not contain slide updates.");
  }
  return {
    slides: parsed.slides
      .map((slide) => ({
        slideNumber: Number(slide.slideNumber),
        html: String(slide.html ?? "")
      }))
      .filter((slide) => Number.isInteger(slide.slideNumber) && slide.slideNumber > 0 && slide.html),
    summary: typeof parsed.summary === "string" ? parsed.summary : undefined
  };
}

function validatedArticleHtml(value: string): string {
  const html = value.trim();
  if (!/^<article\b/i.test(html) || !/<\/article>$/i.test(html) || !/\bclass="[^"]*\bslide\b/i.test(html)) {
    throw new EditorInputError("The AI response must return complete slide article blocks.");
  }
  if (/<(?:html|head|body|style|script)\b/i.test(html)) {
    throw new EditorInputError("The AI response included unsupported document-level markup.");
  }
  return html;
}

function extractImageUrls(value: string): string[] {
  return [...value.matchAll(/https?:\/\/[^\s"'<>]+/gi)].map((match) => cleanInlineUrl(match[0]));
}

function normalizeReturnedSlideArticle(articleHtml: string, instruction: string): string {
  const lower = instruction.toLowerCase();
  const imageUrls = extractImageUrls(instruction);
  if (!imageUrls.length || !/\bimage\b/.test(lower)) return articleHtml;

  const suppliedUrl = imageUrls[0];
  if (suppliedUrl && !articleHtml.includes(suppliedUrl)) {
    throw new EditorInputError("The AI response did not embed the supplied image URL. Try again with the direct image link.");
  }

  const placement = lower.includes("left")
    ? "left"
    : lower.includes("background")
      ? "background"
      : lower.includes("full")
        ? "full"
        : "right";

  let nextHtml = applyVisualPlacement(articleHtml, placement);
  nextHtml = containSlideImage(nextHtml) ?? nextHtml;
  if (placement === "right" || placement === "left") {
    nextHtml = ensureArticleStyle(
      nextHtml,
      "grid-template-columns: minmax(0, 1fr) minmax(220px, .48fr); grid-template-rows: minmax(0, 1fr); align-items: center;"
    );
    nextHtml = ensureFigureStyle(
      nextHtml,
      "height: min(46vh, 390px); max-height: 390px; align-self: center;"
    );
  }
  return nextHtml;
}

function applyVisualPlacement(articleHtml: string, placement: "right" | "left" | "background" | "full"): string {
  const visualClass = placement === "right" ? "visual-right" : `visual-${placement}`;
  return articleHtml.replace(/<article\b([^>]*)class="([^"]*)"([^>]*)>/i, (_full, before, classValue: string, after) => {
    const classes = classValue
      .split(/\s+/)
      .filter((name) => name && !["visual-left", "visual-right", "visual-background", "visual-full"].includes(name));
    if (!classes.includes("has-visual")) classes.push("has-visual");
    classes.push(visualClass);
    return `<article${before}class="${classes.join(" ")}"${after}>`;
  });
}

function ensureArticleStyle(articleHtml: string, requiredStyle: string): string {
  return articleHtml.replace(/<article\b([^>]*)>/i, (full, attrs: string) => {
    const styleMatch = attrs.match(/\sstyle=(?:"([^"]*)"|'([^']*)')/i);
    if (!styleMatch) return `<article${attrs} style="${requiredStyle}">`;
    const currentStyle = styleMatch[1] ?? styleMatch[2] ?? "";
    const mergedStyle = mergeCssDeclarations(currentStyle, requiredStyle);
    return full.replace(styleMatch[0], ` style="${mergedStyle}"`);
  });
}

function ensureFigureStyle(articleHtml: string, requiredStyle: string): string {
  return articleHtml.replace(/<figure\b([^>]*)class="([^"]*\bvisual\b[^"]*)"([^>]*)>/i, (full, before, classValue: string, after) => {
    const tag = `<figure${before}class="${classValue}"${after}>`;
    const styleMatch = tag.match(/\sstyle=(?:"([^"]*)"|'([^']*)')/i);
    if (!styleMatch) return `<figure${before}class="${classValue}"${after} style="${requiredStyle}">`;
    const currentStyle = styleMatch[1] ?? styleMatch[2] ?? "";
    const mergedStyle = mergeCssDeclarations(currentStyle, requiredStyle);
    return full.replace(styleMatch[0], ` style="${mergedStyle}"`);
  });
}

function mergeCssDeclarations(currentStyle: string, requiredStyle: string): string {
  const declarations = new Map<string, string>();
  for (const declaration of `${currentStyle};${requiredStyle}`.split(";")) {
    const [property, ...valueParts] = declaration.split(":");
    const value = valueParts.join(":").trim();
    if (property?.trim() && value) declarations.set(property.trim().toLowerCase(), value);
  }
  return [...declarations.entries()].map(([property, value]) => `${property}: ${value}`).join("; ") + ";";
}

function slideNumberToIndex(value: string): number {
  const normalized = value.toLowerCase();
  const words: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12
  };
  const slideNumber = words[normalized] ?? Number(normalized);
  return Number.isFinite(slideNumber) ? slideNumber - 1 : -1;
}

function cleanInlineUrl(value: string): string {
  return value.trim().replace(/[),.;]+$/g, "");
}

function containImageStyle(): string {
  return "width: 100%; height: 100%; object-fit: contain; object-position: center; padding: clamp(18px, 4vw, 44px); background: #fff;";
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

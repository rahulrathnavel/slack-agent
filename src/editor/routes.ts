import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import type { Application, Request, Response } from "express";
import express from "express";
import type { WebClient } from "@slack/web-api";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { extractJson, NvidiaClient } from "../services/nvidia.js";
import { exportDeckToPptx } from "../services/pptxExport.js";
import type { DeckPlan, DeckRequest } from "../types.js";
import { readJsonFile } from "../storage/files.js";
import { renderEditorPage } from "./page.js";
import { isValidEditorToken } from "./security.js";

const MAX_HTML_BYTES = 1_500_000;
const EDITOR_TARGETED_AI_TIMEOUT_MS = 55_000;
const MAX_AI_TARGET_SLIDES = 4;
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
      const deckId = res.locals.deckId as string;
      const html = validatedHtml(req.body?.html);
      const instruction = String(req.body?.instruction ?? "").trim().slice(0, 4_000);
      const selectedSlide = positiveInteger(req.body?.selectedSlide);
      if (!instruction) throw new EditorInputError("Add an editing instruction.");
      const result = (await applyFastHtmlEdit(html, instruction, selectedSlide)) ?? (await editDeckHtml(nvidia, deckId, html, instruction, selectedSlide));
      await fs.writeFile(draftFile(deckId), result.html, "utf8");
      res.json({ ...result, saved: true });
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
      const detectedExtension = detectImageExtension(req.body);
      if (detectedExtension !== extension) {
        throw new EditorInputError("The uploaded bytes do not match the declared image type.");
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

  api.get("/:deckId/export/pptx", async (_req, res) => {
    try {
      const deckId = res.locals.deckId as string;
      const manifest = await readManifest(deckId);
      const { filename, buffer } = await exportDeckToPptx({
        deckId,
        plan: manifest.plan,
        request: manifest.request,
        html: await currentDeckHtml(deckId)
      });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
      res.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/"/g, "")}"`);
      res.send(buffer);
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

function detectImageExtension(buffer: Buffer): string | undefined {
  if (
    buffer.length >= 45 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) &&
    buffer.subarray(12, 16).toString("ascii") === "IHDR" &&
    validImageDimensions(buffer.readUInt32BE(16), buffer.readUInt32BE(20)) &&
    buffer.includes(Buffer.from("IEND"), Math.max(0, buffer.length - 32))
  ) return "png";
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer.at(-2) === 0xff && buffer.at(-1) === 0xd9) return "jpg";
  if (
    buffer.length >= 20 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP" &&
    buffer.readUInt32LE(4) + 8 <= buffer.length
  ) return "webp";
  if (
    buffer.length >= 14 &&
    /^GIF8[79]a$/.test(buffer.subarray(0, 6).toString("ascii")) &&
    validImageDimensions(buffer.readUInt16LE(6), buffer.readUInt16LE(8)) &&
    buffer.at(-1) === 0x3b
  ) return "gif";
  if (
    buffer.length >= 16 &&
    buffer.subarray(4, 8).toString("ascii") === "ftyp" &&
    /^(?:avif|avis|mif1)$/.test(buffer.subarray(8, 12).toString("ascii")) &&
    buffer.readUInt32BE(0) <= buffer.length
  ) return "avif";
  return undefined;
}

function validImageDimensions(width: number, height: number): boolean {
  return width > 0 && height > 0 && width <= 12_000 && height <= 12_000 && width * height <= 40_000_000;
}

async function editDeckHtml(
  nvidia: NvidiaClient,
  deckId: string,
  html: string,
  instruction: string,
  selectedSlide?: number
): Promise<{ html: string; summary: string }> {
  const slideBlocks = extractSlideBlocks(html);
  if (!slideBlocks.length) {
    throw new EditorInputError("This deck has no editable slide blocks. Regenerate it with the current renderer before using AI edits.");
  }
  const targetIndexes = inferTargetSlideIndexes(html, instruction, selectedSlide);
  if (!targetIndexes.length) {
    throw new EditorInputError("Choose a slide in the assistant or mention a slide number in the instruction.");
  }
  if (targetIndexes.length > MAX_AI_TARGET_SLIDES) {
    throw new EditorInputError(`Edit at most ${MAX_AI_TARGET_SLIDES} slides at a time so each change stays reliable.`);
  }
  return editTargetedSlides(nvidia, deckId, html, instruction, targetIndexes);
}

async function editTargetedSlides(
  nvidia: NvidiaClient,
  deckId: string,
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
  const designContext = extractDeckDesignContext(html);
  let output: string;
  try {
    output = await nvidia.chatText(
      [
        {
          role: "system",
          content: `You are the PioltPPT bounded slide editor. Edit only the supplied slide article blocks.
Return strict JSON only:
{"slides":[{"slideNumber":2,"html":"<article class=\"slide ...\">...</article>"}],"summary":"short user-facing summary"}
Rules:
- Return exactly one complete <article> block for every supplied slide number, in the same order. Never return a full document.
- Preserve each article's id, data-slide-id, aria-label, data attributes, slide number, and existing class conventions unless a requested layout needs an additional safe class.
- Do not include html, head, body, style, script, iframe, object, embed, link, meta, base, form, input, button, SVG, event-handler attributes, or javascript/data URLs.
- Keep content concise, professional, relevant to the existing slide, and presentation-ready. Do not invent facts or placeholders.
- Treat natural-language requests as real editing directions. For example, "combine the points into one paragraph" means remove the bullets and create one clear paragraph from their meaning.
- A redesign may change hierarchy, inline presentation styles, text structure, or image placement while keeping the slide coherent and responsive.
- Use only image URLs already present in the supplied slide or explicitly present in the editing instruction. Never invent or search for an image URL.
- Images must use object-fit: contain by default, descriptive alt text, and a layout that reserves space so text does not overlap.
- For a left/right image, use a responsive two-column article layout and reduce text to the strongest points if needed.`
        },
        {
          role: "user",
          content: `Editing instruction:\n${instruction}\n\nDeck design tokens and slide CSS (reference only):\n${designContext}\n\nCurrent slide blocks:\n${slidePayload}`
        }
      ],
        { model: config.NVIDIA_MODEL_FAST, temperature: 0.15, maxTokens: 2_800, timeoutMs: EDITOR_TARGETED_AI_TIMEOUT_MS }
      );
  } catch (error) {
    logger.warn({ error, targetSlides: targetSlides.map((slide) => slide.index + 1) }, "Bounded slide edit failed");
    throw new EditorInputError("The AI provider could not complete this slide edit. Your draft was not changed; please try again.", 502);
  }
  const patch = parseSlidePatch(output);
  validatePatchTargets(patch, targetIndexes);
  const replacements = new Map<number, string>();
  for (const item of patch.slides) {
    const index = item.slideNumber - 1;
    const original = slideBlocks[index];
    if (!original) throw new EditorInputError(`Slide ${item.slideNumber} no longer exists.`);
    let replacement = validatedArticleHtml(item.html);
    validateSlideIdentity(original.html, replacement, item.slideNumber);
    replacement = normalizeReturnedSlideArticle(replacement, instruction);
    validateArticleImages(deckId, original.html, replacement, instruction);
    replacements.set(index, replacement);
  }
  return {
    html: validatedHtml(replaceSlideBlocks(html, replacements)),
    summary: patch.summary || `Updated slide ${targetSlides.map((slide) => slide.index + 1).join(", ")}.`
  };
}

async function applyFastHtmlEdit(html: string, instruction: string, selectedSlide?: number): Promise<{ html: string; summary: string } | undefined> {
  const index = inferSlideIndex(html, instruction) ?? selectedSlideIndex(html, selectedSlide);
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

function selectedSlideIndex(html: string, selectedSlide?: number): number | undefined {
  if (!selectedSlide) return undefined;
  const index = selectedSlide - 1;
  return index >= 0 && index < extractSlideBlocks(html).length ? index : undefined;
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

function inferTargetSlideIndexes(html: string, instruction: string, selectedSlide?: number): number[] {
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
  if (!indexes.size) {
    const selected = selectedSlideIndex(html, selectedSlide);
    if (selected !== undefined) indexes.add(selected);
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
  let parsed: Partial<SlidePatch>;
  try {
    parsed = JSON.parse(extractJson(output)) as Partial<SlidePatch>;
  } catch {
    throw new EditorInputError("The AI returned an invalid slide patch. Your draft was not changed.");
  }
  if (!Array.isArray(parsed.slides)) {
    throw new EditorInputError("The AI response did not contain slide updates. Your draft was not changed.");
  }
  return {
    slides: parsed.slides.map((slide) => ({
      slideNumber: Number(slide.slideNumber),
      html: String(slide.html ?? "")
    })),
    summary: typeof parsed.summary === "string" ? parsed.summary.slice(0, 500) : undefined
  };
}

function validatePatchTargets(patch: SlidePatch, targetIndexes: number[]): void {
  const expected = targetIndexes.map((index) => index + 1);
  const actual = patch.slides.map((slide) => slide.slideNumber);
  if (
    actual.length !== expected.length ||
    actual.some((slideNumber, index) => !Number.isInteger(slideNumber) || slideNumber !== expected[index]) ||
    patch.slides.some((slide) => !slide.html.trim())
  ) {
    throw new EditorInputError(`The AI must return exactly slides ${expected.join(", ")} in order. Your draft was not changed.`);
  }
}

function validateSlideIdentity(original: string, replacement: string, slideNumber: number): void {
  for (const attribute of ["id", "data-slide-id", "aria-label"]) {
    const originalValue = articleAttribute(original, attribute);
    if (originalValue !== undefined && articleAttribute(replacement, attribute) !== originalValue) {
      throw new EditorInputError(`The AI changed the identity of slide ${slideNumber}. Your draft was not changed.`);
    }
  }
}

function articleAttribute(articleHtml: string, name: string): string | undefined {
  const openingTag = articleHtml.match(/^<article\b[^>]*>/i)?.[0] ?? "";
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return openingTag.match(new RegExp(`\\b${escapedName}\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')`, "i"))?.slice(1).find((value) => value !== undefined);
}

function validateArticleImages(deckId: string, original: string, replacement: string, instruction: string): void {
  const allowed = new Set([...extractImageSources(original), ...extractImageUrls(instruction)].map(decodeHtmlEntitiesForValidation));
  const trustedPrefix = `/decks/${encodeURIComponent(deckId)}/assets/`;
  for (const rawSource of extractImageSources(replacement)) {
    const source = decodeHtmlEntitiesForValidation(rawSource);
    if (allowed.has(source)) continue;
    if (source.startsWith(trustedPrefix) && /^\/decks\/[A-Za-z0-9%_-]+\/assets\/[A-Za-z0-9._-]+$/.test(source)) continue;
    throw new EditorInputError("The AI introduced an image URL that was not supplied by you. Your draft was not changed.");
  }
}

function extractImageSources(value: string): string[] {
  return [...value.matchAll(/<img\b[^>]*\bsrc\s*=\s*(?:\"([^\"]+)\"|'([^']+)')[^>]*>/gi)]
    .map((match) => match[1] ?? match[2] ?? "")
    .filter(Boolean);
}

function extractDeckDesignContext(html: string): string {
  const style = html.match(/<style\b[^>]*>([\s\S]*?)<\/style>/i)?.[1] ?? "";
  const root = style.match(/:root\s*\{[^}]*\}/i)?.[0] ?? "";
  const rules = [...style.matchAll(/([^{}]*(?:\.slide|\.content|\.visual|\.bullets|\bh1\b|\bh2\b|\.subtitle)[^{}]*)\{([^{}]*)\}/gi)]
    .slice(0, 18)
    .map((match) => `${match[1]?.trim()} { ${match[2]?.trim()} }`)
    .join("\n");
  return `${root}\n${rules}`.trim().slice(0, 8_000) || "Use the existing classes and responsive layout in the supplied article.";
}

function validatedArticleHtml(value: string): string {
  const html = value.trim();
  if (!/^<article\b/i.test(html) || !/<\/article>$/i.test(html) || !/\bclass=(?:"[^"]*\bslide\b[^"]*"|'[^']*\bslide\b[^']*')/i.test(html)) {
    throw new EditorInputError("The AI response must return complete slide article blocks.");
  }
  validateSafeSlideMarkup(html);
  return html;
}

function validateSafeSlideMarkup(html: string): void {
  if ((html.match(/<article\b/gi)?.length ?? 0) !== 1 || (html.match(/<\/article>/gi)?.length ?? 0) !== 1) {
    throw new EditorInputError("The AI response must contain exactly one slide article.");
  }
  const allowedTags = new Set(["article", "div", "h1", "h2", "h3", "p", "ul", "ol", "li", "figure", "img", "blockquote", "footer", "span", "strong", "em", "small", "br", "a"]);
  for (const match of html.matchAll(/<\/?([a-z][a-z0-9-]*)\b[^>]*>/gi)) {
    const tag = (match[1] ?? "").toLowerCase();
    if (!allowedTags.has(tag)) throw new EditorInputError(`The AI response included an unsupported <${tag}> element.`);
    if (match[0].startsWith("</")) continue;
    const attributeText = match[0].replace(/^<[a-z][a-z0-9-]*/i, "").replace(/\/?\s*>$/, "");
    const consumed = attributeText.replace(/\s+([a-z_:][a-z0-9_.:-]*)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?/gi, (_full, name: string) => {
      validateSlideAttribute(tag, name, _full);
      return "";
    });
    if (consumed.trim()) throw new EditorInputError("The AI response included malformed slide attributes.");
  }
}

function validateSlideAttribute(tag: string, rawName: string, rawAttribute: string): void {
  const name = rawName.toLowerCase();
  const allowed = /^(?:class|id|style|title|role|alt|loading|width|height|target|rel|tabindex|aria-[a-z0-9_.:-]+|data-[a-z0-9_.:-]+)$/i.test(name);
  if (name.startsWith("on") || name === "srcset" || name === "poster" || name === "action" || name === "formaction") {
    throw new EditorInputError("The AI response included an unsafe resource or event attribute.");
  }
  if (name === "src" && tag !== "img") throw new EditorInputError("Only slide images may use a src attribute.");
  if (name === "href" && tag !== "a") throw new EditorInputError("Only links may use a href attribute.");
  if (!allowed && name !== "src" && name !== "href") throw new EditorInputError(`The AI response included an unsupported ${name} attribute.`);
  const value = decodeHtmlEntitiesForValidation(rawAttribute.match(/=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))/)?.slice(1).find((part) => part !== undefined) ?? "").trim();
  if (name === "style" && /(?:url\s*\(|expression\s*\(|@import|behavior\s*:|-moz-binding)/i.test(value)) {
    throw new EditorInputError("The AI response included unsafe external CSS.");
  }
  if (name === "href" && value && !/^(?:https?:\/\/|\/|#)/i.test(value)) {
    throw new EditorInputError("The AI response included an unsafe link URL.");
  }
  if (name === "src" && value && !/^(?:https?:\/\/|\/)/i.test(value)) {
    throw new EditorInputError("The AI response included an unsafe image URL.");
  }
}

function decodeHtmlEntitiesForValidation(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#([0-9]+);?/g, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&colon;/gi, ":")
    .replace(/&sol;/gi, "/")
    .replace(/&amp;/gi, "&");
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
      "height: min(52vh, 440px); max-height: 440px; align-self: center; border: 0; background: transparent;"
    );
    nextHtml = addVisualClass(nextHtml, "visual-embedded");
  }
  return nextHtml;
}

function addVisualClass(articleHtml: string, className: string): string {
  return articleHtml.replace(/<figure\b([^>]*)class="([^"]*\bvisual\b[^"]*)"([^>]*)>/i, (_full, before, classes: string, after) => {
    const names = classes.split(/\s+/).filter(Boolean);
    if (!names.includes(className)) names.push(className);
    return `<figure${before}class="${names.join(" ")}"${after}>`;
  });
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

async function currentDeckHtml(deckId: string): Promise<string> {
  try {
    return await fs.readFile(draftFile(deckId), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return fs.readFile(deckFile(deckId, "index.html"), "utf8");
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

function positiveInteger(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
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

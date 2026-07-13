import fs from "node:fs/promises";
import path from "node:path";
import * as PptxGenModule from "pptxgenjs";
import { config } from "../config.js";
import { deckFilename } from "../deck/render.js";
import type { DeckPlan, DeckRequest, SlidePlan } from "../types.js";

interface ExportArgs {
  deckId: string;
  plan: DeckPlan;
  request: DeckRequest;
  html?: string;
}

const COLORS = {
  "executive-clean": { bg: "F7F4EE", ink: "111827", accent: "2563EB", muted: "4B5563" },
  "startup-bright": { bg: "FFF8ED", ink: "14213D", accent: "E11D48", muted: "475569" },
  editorial: { bg: "F8FAFC", ink: "1F2937", accent: "B45309", muted: "475569" },
  "dark-stage": { bg: "101113", ink: "F9FAFB", accent: "38BDF8", muted: "CBD5E1" },
  minimal: { bg: "FBFBF8", ink: "18181B", accent: "0F766E", muted: "52525B" }
};

const PptxGenConstructor = ((PptxGenModule as any).default ?? PptxGenModule) as new () => any;

export async function exportDeckToPptx(args: ExportArgs): Promise<{ filename: string; buffer: Buffer }> {
  const theme = COLORS[args.request.brandStyle] ?? COLORS["executive-clean"];
  const exportPlan = args.html ? deckPlanFromHtml(args.html, args.plan) : args.plan;
  const pptx = new PptxGenConstructor();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "PioltPPT";
  pptx.company = "PioltPPT";
  pptx.subject = exportPlan.subtitle;
  pptx.title = exportPlan.title;
  pptx.lang = "en-US";
  pptx.theme = {
    headFontFace: "Aptos Display",
    bodyFontFace: "Aptos",
    lang: "en-US"
  };

  exportPlan.slides.forEach((slide, index) => renderPptxSlide(pptx, slide, index, exportPlan.slides.length, theme));
  const filename = `${deckFilename(exportPlan.title)}-${args.deckId}.pptx`;
  const output = (await pptx.write({ outputType: "nodebuffer" })) as Buffer | ArrayBuffer | Uint8Array;
  return { filename, buffer: Buffer.from(output as ArrayBuffer) };
}

export async function writeDeckPptx(args: ExportArgs): Promise<{ filename: string; path: string }> {
  const { filename, buffer } = await exportDeckToPptx(args);
  await fs.mkdir(config.exportsDir, { recursive: true });
  const outputPath = path.join(config.exportsDir, filename);
  await fs.writeFile(outputPath, buffer);
  return { filename, path: outputPath };
}

function renderPptxSlide(
  pptx: any,
  slidePlan: SlidePlan,
  index: number,
  total: number,
  theme: { bg: string; ink: string; accent: string; muted: string }
): void {
  const slide = pptx.addSlide();
  slide.background = { color: theme.bg };
  slide.addText(`${index + 1} / ${total}`, {
    x: 0.72,
    y: 0.58,
    w: 1.2,
    h: 0.24,
    fontFace: "Aptos",
    fontSize: 10,
    bold: true,
    color: theme.accent,
    margin: 0
  });

  const isTitle = index === 0 || slidePlan.layout === "title";
  const titleFont = isTitle ? 42 : 32;
  slide.addText(slidePlan.title, {
    x: 0.72,
    y: isTitle ? 2.15 : 1.45,
    w: slidePlan.chart ? 6.2 : 11.8,
    h: isTitle ? 1.35 : 0.72,
    fontFace: "Aptos Display",
    fontSize: titleFont,
    bold: true,
    color: theme.ink,
    fit: "shrink",
    breakLine: false,
    margin: 0
  });

  if (slidePlan.subtitle) {
    slide.addText(slidePlan.subtitle, {
      x: 0.72,
      y: isTitle ? 3.52 : 2.22,
      w: slidePlan.chart ? 5.8 : 10.9,
      h: 0.6,
      fontFace: "Aptos",
      fontSize: isTitle ? 18 : 15,
      color: theme.muted,
      fit: "shrink",
      margin: 0
    });
  }

  if (slidePlan.chart) {
    renderChart(pptx, slide, slidePlan, theme);
  } else if (slidePlan.layout === "closing" && !slidePlan.bullets.length) {
    slide.addText("Questions, discussion, and next steps", {
      x: 0.72,
      y: 3.65,
      w: 8.6,
      h: 0.45,
      fontFace: "Aptos",
      fontSize: 22,
      color: theme.muted,
      margin: 0
    });
  } else if (slidePlan.bullets.length) {
    slide.addText(
      slidePlan.bullets.map((bullet) => ({ text: bullet, options: { bullet: { type: "ul" as const } } })),
      {
        x: 0.95,
        y: slidePlan.subtitle ? 2.95 : 2.55,
        w: 10.8,
        h: 3.3,
        fontFace: "Aptos",
        fontSize: 18,
        color: theme.ink,
        breakLine: false,
        paraSpaceAfterPt: 10,
        fit: "shrink",
        margin: 0.06
      }
    );
  }

  if (slidePlan.dataCitation) {
    slide.addText(slidePlan.dataCitation, {
      x: 0.72,
      y: 6.98,
      w: 11.8,
      h: 0.26,
      fontFace: "Aptos",
      fontSize: 7.5,
      color: theme.muted,
      fit: "shrink",
      margin: 0
    });
  }

  slide.addShape(pptx.ShapeType.line, {
    x: 0.72,
    y: 6.75,
    w: 11.9,
    h: 0,
    line: { color: theme.accent, transparency: 20, width: 1 }
  });
}

function renderChart(
  pptx: any,
  slide: any,
  slidePlan: SlidePlan,
  theme: { bg: string; ink: string; accent: string; muted: string }
): void {
  const chart = slidePlan.chart;
  if (!chart) return;
  const max = Math.max(...chart.values, 1);
  const x = 7.2;
  const y = 1.45;
  const w = 5.2;
  const h = 4.65;
  slide.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: { color: "FFFFFF", transparency: 0 }, line: { color: "D8DEE8" } });
  slide.addText(chart.title, { x: x + 0.28, y: y + 0.22, w: w - 0.56, h: 0.3, fontSize: 12, bold: true, color: theme.ink, margin: 0 });

  const barAreaY = y + 0.85;
  const barAreaH = 3.15;
  const step = (w - 0.72) / Math.max(chart.values.length, 1);
  chart.values.forEach((value, i) => {
    const barH = Math.max(0.05, (value / max) * barAreaH);
    const barW = Math.min(0.42, step * 0.58);
    const barX = x + 0.42 + i * step + (step - barW) / 2;
    const barY = barAreaY + barAreaH - barH;
    slide.addShape(pptx.ShapeType.rect, { x: barX, y: barY, w: barW, h: barH, fill: { color: theme.accent }, line: { color: theme.accent } });
    slide.addText(shortLabel(chart.labels[i] ?? ""), {
      x: barX - 0.22,
      y: barAreaY + barAreaH + 0.14,
      w: barW + 0.44,
      h: 0.42,
      fontSize: 7.5,
      color: theme.muted,
      align: "center",
      fit: "shrink",
      margin: 0
    });
  });
  slide.addText(chart.valueLabel, { x: x + 0.28, y: y + h - 0.4, w: w - 0.56, h: 0.2, fontSize: 8, color: theme.muted, align: "right", margin: 0 });
}

export function deckPlanFromHtml(html: string, fallback: DeckPlan): DeckPlan {
  const articles = [...html.matchAll(/<article\b[^>]*class=(?:"[^"]*\bslide\b[^"]*"|'[^']*\bslide\b[^']*')[^>]*>[\s\S]*?<\/article>/gi)].map((match) => match[0]);
  if (!articles.length) return fallback;
  const slides = articles.map((article, index): SlidePlan => {
    const existing = fallback.slides[index];
    const title = textMatch(article, /<h[12]\b[^>]*>([\s\S]*?)<\/h[12]>/i) || existing?.title || `Slide ${index + 1}`;
    const subtitle = textMatch(article, /<p\b[^>]*class=(?:"[^"]*\bsubtitle\b[^"]*"|'[^']*\bsubtitle\b[^']*')[^>]*>([\s\S]*?)<\/p>/i) || existing?.subtitle;
    const bullets = [...article.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((match) => plainText(match[1] ?? "")).filter(Boolean);
    const dataCitation = textMatch(article, /<footer\b[^>]*class=(?:"[^"]*\bcitation\b[^"]*"|'[^']*\bcitation\b[^']*')[^>]*>([\s\S]*?)<\/footer>/i) || existing?.dataCitation;
    const hasChart = /\bchart-visual\b/i.test(article);
    return {
      ...(existing ?? { layout: index === 0 ? "title" : "bullets", bullets: [] }),
      title,
      subtitle,
      layout: existing?.layout === "chart" && !hasChart ? "bullets" : existing?.layout ?? (index === 0 ? "title" : "bullets"),
      bullets,
      chart: hasChart ? existing?.chart : undefined,
      dataCitation
    };
  });
  return {
    ...fallback,
    title: slides[0]?.title || fallback.title,
    slides
  };
}

function textMatch(html: string, pattern: RegExp): string | undefined {
  const value = html.match(pattern)?.[1];
  const text = value ? plainText(value) : "";
  return text || undefined;
}

function plainText(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#0?39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function shortLabel(value: string): string {
  return value.length > 16 ? `${value.slice(0, 15)}...` : value;
}

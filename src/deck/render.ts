import fs from "node:fs/promises";
import path from "node:path";
import sanitizeFilename from "sanitize-filename";
import { writeJsonFile } from "../storage/files.js";
import type {
  DeckAsset,
  DeckPlan,
  DeckRequest,
  ImagePlacement,
  ResearchSource,
  SlidePlan,
  SlideTransition
} from "../types.js";

interface RenderDeckArgs {
  deckId: string;
  outputDir: string;
  publicUrl: string;
  plan: DeckPlan;
  request: DeckRequest;
  assets: DeckAsset[];
  sources: ResearchSource[];
}

const THEME_COLORS: Record<string, { bg: string; ink: string; accent: string; accent2: string; surface: string }> = {
  "executive-clean": {
    bg: "#f7f4ee",
    ink: "#111827",
    accent: "#2563eb",
    accent2: "#0f766e",
    surface: "#ffffff"
  },
  "startup-bright": {
    bg: "#fff8ed",
    ink: "#14213d",
    accent: "#e11d48",
    accent2: "#0891b2",
    surface: "#ffffff"
  },
  editorial: {
    bg: "#f8fafc",
    ink: "#1f2937",
    accent: "#b45309",
    accent2: "#4f46e5",
    surface: "#ffffff"
  },
  "dark-stage": {
    bg: "#101113",
    ink: "#f9fafb",
    accent: "#38bdf8",
    accent2: "#f59e0b",
    surface: "#1f2937"
  },
  minimal: {
    bg: "#fbfbf8",
    ink: "#18181b",
    accent: "#0f766e",
    accent2: "#b91c1c",
    surface: "#ffffff"
  }
};

export async function renderDeckSite(args: RenderDeckArgs): Promise<void> {
  await fs.mkdir(args.outputDir, { recursive: true });
  const html = renderHtml(args);
  await fs.writeFile(path.join(args.outputDir, "index.html"), html, "utf8");
  await writeJsonFile(path.join(args.outputDir, "deck.json"), {
    deckId: args.deckId,
    publicUrl: args.publicUrl,
    plan: args.plan,
    request: args.request,
    assets: args.assets,
    sources: args.sources
  });
}

function renderHtml({ deckId, plan, request, assets, sources }: RenderDeckArgs): string {
  const theme = THEME_COLORS[request.brandStyle] ?? THEME_COLORS["executive-clean"]!;
  const slides = plan.slides.map((slide, index) =>
    renderSlide(slide, index, plan.slides.length, assets, request, transitionForSlide(request, index))
  );
  const safeTitle = escapeHtml(plan.title);
  const sourceItems = sources
    .slice(0, 18)
    .map((source) => {
      return `<li><a href="${escapeAttribute(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(
        source.title
      )}</a><span>${escapeHtml(source.sourceType)}</span></li>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle} | PioltPPT</title>
  <meta name="description" content="${escapeAttribute(plan.subtitle)}" />
  <style>
    :root {
      --bg: ${theme.bg};
      --ink: ${theme.ink};
      --accent: ${theme.accent};
      --accent-2: ${theme.accent2};
      --surface: ${theme.surface};
      --muted: color-mix(in srgb, var(--ink) 68%, var(--bg));
      --line: color-mix(in srgb, var(--ink) 16%, transparent);
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; background: var(--bg); color: var(--ink); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; letter-spacing: 0; }
    body { overflow: hidden; }
    .deck-shell { width: 100vw; height: 100vh; display: grid; grid-template-rows: minmax(0, 1fr) auto; }
    .slides { min-height: 0; height: 100%; position: relative; overflow: hidden; }
    .slide { position: absolute; inset: 0; min-height: 0; padding: clamp(24px, 4.4vh, 54px) clamp(24px, 5.6vw, 82px); display: grid; grid-template-columns: minmax(0, 1fr); gap: clamp(22px, 3.6vw, 58px); align-items: stretch; opacity: 0; overflow: hidden; pointer-events: none; }
    .slide.active { opacity: 1; transform: translateX(0); pointer-events: auto; }
    .slide.transition-slide { transform: translateX(2vw); transition: opacity 240ms ease, transform 240ms ease; }
    .slide.transition-fade { transform: none; transition: opacity 260ms ease; }
    .slide.transition-zoom { transform: scale(.985); transition: opacity 260ms ease, transform 260ms ease; }
    .slide.transition-none { transform: none; transition: none; }
    .slide.transition-slide.active, .slide.transition-fade.active, .slide.transition-zoom.active, .slide.transition-none.active { transform: translateX(0) scale(1); opacity: 1; }
    .slide-title { grid-template-columns: minmax(0, 1fr); align-content: center; }
    .has-visual { grid-template-columns: minmax(0, 1fr) minmax(280px, .78fr); }
    .visual-left .content { order: 2; }
    .visual-left .visual { order: 1; }
    .visual-full { grid-template-columns: 1fr; grid-template-rows: minmax(0, auto) minmax(240px, 1fr); }
    .visual-full .visual { height: min(46vh, 420px); }
    .visual-background { grid-template-columns: 1fr; }
    .visual-background .visual { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; opacity: .2; }
    .visual-background .visual::after { display: none; }
    .visual-background .content { position: relative; z-index: 1; max-width: 980px; }
    .content { min-width: 0; max-height: 100%; align-self: center; display: flex; flex-direction: column; justify-content: center; overflow: hidden; }
    .slide-title .content { max-width: 1040px; }
    .kicker { color: var(--accent); font-size: clamp(11px, 1.1vw, 14px); font-weight: 800; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 14px; }
    h1, h2 { margin: 0; line-height: .98; letter-spacing: 0; }
    h1, h2 { max-width: 100%; overflow-wrap: break-word; text-wrap: balance; }
    h1 { font-size: clamp(42px, 7.2vw, 92px); }
    h2 { font-size: clamp(34px, 4.8vw, 66px); }
    .heading-long h1 { font-size: clamp(34px, 5.8vw, 74px); line-height: 1.02; }
    .heading-long h2 { font-size: clamp(28px, 4.1vw, 54px); line-height: 1.04; }
    .heading-extra-long h1 { font-size: clamp(30px, 4.8vw, 62px); line-height: 1.05; }
    .heading-extra-long h2 { font-size: clamp(25px, 3.5vw, 46px); line-height: 1.06; }
    .subtitle { margin-top: 16px; color: var(--muted); font-size: clamp(18px, 1.75vw, 28px); line-height: 1.24; max-width: 880px; text-wrap: balance; }
    .presenters { margin-top: 30px; display: flex; gap: 12px; flex-wrap: wrap; color: var(--muted); font-weight: 700; }
    .presenters span { border-top: 2px solid var(--accent); padding-top: 10px; }
    .bullets { list-style: none; padding: 0; margin: 26px 0 0; display: grid; gap: clamp(10px, 1.45vh, 16px); max-width: 880px; }
    .bullets li { display: grid; grid-template-columns: 18px 1fr; gap: 14px; align-items: start; font-size: clamp(17px, 1.65vw, 26px); line-height: 1.24; color: var(--ink); overflow-wrap: break-word; }
    .bullets li::before { content: ""; width: 10px; height: 10px; margin-top: .55em; background: var(--accent-2); transform: rotate(45deg); }
    .visual { width: 100%; height: min(58vh, 520px); max-height: 100%; align-self: center; border: 1px solid var(--line); background: color-mix(in srgb, var(--surface) 88%, var(--accent) 12%); display: grid; place-items: center; overflow: hidden; position: relative; }
    .visual img { width: 100%; height: 100%; object-fit: cover; display: block; filter: saturate(.96) contrast(1.02); }
    .visual.visual-contain img { object-fit: contain; object-position: center; padding: clamp(18px, 4vw, 44px); background: var(--surface); }
    .visual.visual-embedded { border: 0; background: transparent; }
    .visual.visual-embedded::after { display: none; }
    .visual.visual-embedded img { padding: 0; background: transparent; }
    .visual::after { content: ""; position: absolute; inset: auto 0 0 0; height: 8px; background: linear-gradient(90deg, var(--accent), var(--accent-2)); }
    .visual.chart-visual { border: 0; background: var(--surface); padding: clamp(14px, 2.5vw, 30px); }
    .visual.chart-visual::after { display: none; }
    .chart-svg { width: 100%; height: 100%; overflow: visible; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    .chart-grid { stroke: color-mix(in srgb, var(--ink) 14%, transparent); stroke-width: 1; }
    .chart-axis { fill: var(--muted); font-size: 12px; }
    .chart-value { fill: var(--ink); font-size: 12px; font-weight: 750; }
    .chart-bar { fill: var(--accent); }
    .chart-line { fill: none; stroke: var(--accent); stroke-width: 4; stroke-linecap: round; stroke-linejoin: round; }
    .chart-point { fill: var(--accent-2); stroke: var(--surface); stroke-width: 3; }
    .citation { position: absolute; left: clamp(24px, 5.6vw, 82px); bottom: 14px; max-width: calc(100% - 48px); color: var(--muted); font-size: 12px; line-height: 1.25; overflow-wrap: anywhere; }
    .quote { font-size: clamp(28px, 3.6vw, 56px); line-height: 1.1; border-left: 8px solid var(--accent); padding-left: 28px; overflow-wrap: break-word; }
    .meta { position: fixed; top: 18px; right: 22px; font-size: 13px; color: var(--muted); z-index: 3; }
    .controls { min-width: 0; border-top: 1px solid var(--line); display: grid; grid-template-columns: auto minmax(48px, 1fr) auto; gap: 14px; align-items: center; padding: 12px 18px; background: color-mix(in srgb, var(--bg) 94%, var(--surface)); }
    .controls > div:first-child { display: flex; gap: 4px; }
    button { appearance: none; border: 1px solid var(--line); background: var(--surface); color: var(--ink); min-width: 42px; height: 42px; font: inherit; font-weight: 800; cursor: pointer; }
    button:hover { border-color: var(--accent); color: var(--accent); }
    .progress { height: 8px; background: color-mix(in srgb, var(--ink) 12%, transparent); position: relative; overflow: hidden; }
    .bar { position: absolute; inset: 0 auto 0 0; width: 0%; background: linear-gradient(90deg, var(--accent), var(--accent-2)); transition: width 180ms ease; }
    .counter { min-width: 72px; text-align: right; color: var(--muted); font-weight: 800; }
    .notes { display: none; position: fixed; left: 24px; bottom: 76px; max-width: 520px; padding: 18px; background: var(--surface); border: 1px solid var(--line); box-shadow: 0 16px 50px rgba(0,0,0,.18); color: var(--ink); z-index: 4; line-height: 1.45; }
    .notes.visible { display: block; }
    .sources { position: fixed; inset: 72px 24px 76px auto; width: min(420px, calc(100vw - 48px)); background: var(--surface); color: var(--ink); border: 1px solid var(--line); padding: 18px; overflow: auto; transform: translateX(calc(100% + 32px)); transition: transform 220ms ease; z-index: 5; }
    .sources.visible { transform: translateX(0); }
    .sources h3 { margin: 0 0 12px; }
    .sources ol { margin: 0; padding-left: 22px; display: grid; gap: 10px; }
    .sources li span { display: block; color: var(--muted); font-size: 12px; text-transform: uppercase; margin-top: 4px; }
    a { color: var(--accent); }
    @media (max-width: 820px) {
      body { overflow: hidden; }
      .slide, .has-visual { min-width: 0; grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, .82fr); gap: 18px; padding: 60px 22px 22px; align-content: center; }
      .slide-title { grid-template-rows: 1fr; }
      .visual-left .content, .visual-left .visual { order: initial; }
      .visual { height: min(30vh, 260px); }
      .content { width: 100%; min-width: 0; }
      h1 { font-size: clamp(30px, 9vw, 48px); overflow-wrap: anywhere; }
      h2 { font-size: clamp(26px, 7.5vw, 42px); overflow-wrap: anywhere; }
      .bullets li { font-size: clamp(17px, 5vw, 24px); }
      .meta { top: 12px; right: 14px; }
      .controls { gap: 8px; padding: 8px; }
      button { min-width: 38px; height: 38px; }
      .counter { min-width: 48px; }
    }
    @media print {
      body { overflow: visible; }
      .deck-shell { height: auto; display: block; }
      .slides { height: auto; overflow: visible; }
      .slide { position: relative; opacity: 1; transform: none; page-break-after: always; min-height: 100vh; }
      .controls, .meta, .notes, .sources { display: none !important; }
    }
  </style>
</head>
<body>
  <main class="deck-shell" data-deck-id="${escapeAttribute(deckId)}">
    <div class="meta">PioltPPT live deck</div>
    <section class="slides" aria-live="polite">
      ${slides.join("\n")}
    </section>
    <aside class="notes" id="notes"></aside>
    <aside class="sources" id="sources"><h3>Sources</h3><ol>${sourceItems}</ol></aside>
    <nav class="controls" aria-label="Deck controls">
      <div>
        <button id="prev" aria-label="Previous slide">&lsaquo;</button>
        <button id="next" aria-label="Next slide">&rsaquo;</button>
        <button id="printDeck" aria-label="Print or save as PDF">P</button>
        <button id="toggleNotes" aria-label="Toggle speaker notes">N</button>
        <button id="toggleSources" aria-label="Toggle sources">S</button>
      </div>
      <div class="progress" aria-hidden="true"><div class="bar" id="bar"></div></div>
      <div class="counter" id="counter"></div>
    </nav>
  </main>
  <script>
    const slides = Array.from(document.querySelectorAll('.slide'));
    const notes = document.getElementById('notes');
    const sources = document.getElementById('sources');
    const bar = document.getElementById('bar');
    const counter = document.getElementById('counter');
    let current = 0;
    function show(index) {
      current = Math.max(0, Math.min(slides.length - 1, index));
      slides.forEach((slide, i) => slide.classList.toggle('active', i === current));
      const active = slides[current];
      notes.textContent = active.dataset.notes || 'No speaker notes for this slide.';
      bar.style.width = ((current + 1) / slides.length * 100) + '%';
      counter.textContent = (current + 1) + ' / ' + slides.length;
      history.replaceState(null, '', '#' + (current + 1));
    }
    document.getElementById('prev').addEventListener('click', () => show(current - 1));
    document.getElementById('next').addEventListener('click', () => show(current + 1));
    document.getElementById('printDeck').addEventListener('click', () => window.print());
    document.getElementById('toggleNotes').addEventListener('click', () => notes.classList.toggle('visible'));
    document.getElementById('toggleSources').addEventListener('click', () => sources.classList.toggle('visible'));
    window.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight' || event.key === ' ') show(current + 1);
      if (event.key === 'ArrowLeft') show(current - 1);
      if (event.key.toLowerCase() === 'n') notes.classList.toggle('visible');
      if (event.key.toLowerCase() === 's') sources.classList.toggle('visible');
    });
    const start = Number(location.hash.replace('#', '')) - 1;
    show(Number.isFinite(start) ? start : 0);
  </script>
</body>
</html>`;
}

function renderSlide(
  slide: SlidePlan,
  index: number,
  total: number,
  assets: DeckAsset[],
  request: DeckRequest,
  transition: SlideTransition
): string {
  const asset = chooseAsset(slide, assets, index);
  const titleTag = index === 0 ? "h1" : "h2";
  const bullets = slide.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("");
  const headingClass = headingSizeClass(slide.title);
  const visualClass = asset ? visualPlacementClass(asset.placement) : slide.chart ? "has-visual visual-right" : "";
  const presenters =
    index === 0 && request.presenters.length
      ? `<div class="presenters">${request.presenters.map((presenter) => `<span>${escapeHtml(presenter)}</span>`).join("")}</div>`
      : "";
  const visual = asset
    ? `<figure class="visual${shouldContainAsset(asset) ? " visual-contain" : ""}"><img src="${escapeAttribute(asset.thumbnailUrl || asset.url)}" alt="${escapeAttribute(
        asset.title
      )}" loading="lazy" /></figure>`
    : slide.chart
      ? `<figure class="visual chart-visual" aria-label="${escapeAttribute(slide.chart.title)}">${renderChart(slide.chart)}</figure>`
      : "";
  const layoutClass = index === 0 ? "slide-title" : `slide-${slide.layout}`;
  const visualMarkup = visual;
  const notes = escapeAttribute(slide.speakerNotes ?? "");

  if (slide.layout === "quote") {
    return `<article class="slide transition-${transition} ${layoutClass} ${headingClass} ${visualClass}" data-slide-id="slide-${index + 1}" data-notes="${notes}" aria-label="Slide ${index + 1} of ${total}">
      <div class="content">
        <div class="kicker">${index + 1} / ${total}</div>
        <blockquote class="quote">${escapeHtml(slide.bullets[0] || slide.title)}</blockquote>
      </div>
      ${visualMarkup}
      ${slide.dataCitation ? `<footer class="citation">${escapeHtml(slide.dataCitation)}</footer>` : ""}
    </article>`;
  }

  return `<article class="slide transition-${transition} ${layoutClass} ${headingClass} ${visualClass}" data-slide-id="slide-${index + 1}" data-notes="${notes}" aria-label="Slide ${index + 1} of ${total}">
    <div class="content">
      <div class="kicker">${index + 1} / ${total}</div>
      <${titleTag}>${escapeHtml(slide.title)}</${titleTag}>
      ${slide.subtitle ? `<p class="subtitle">${escapeHtml(slide.subtitle)}</p>` : ""}
      ${bullets ? `<ul class="bullets">${bullets}</ul>` : ""}
      ${presenters}
    </div>
    ${visualMarkup}
    ${slide.dataCitation ? `<footer class="citation">${escapeHtml(slide.dataCitation)}</footer>` : ""}
  </article>`;
}

function renderChart(chart: NonNullable<SlidePlan["chart"]>): string {
  const width = 720;
  const height = 420;
  const left = 54;
  const right = 24;
  const top = 28;
  const bottom = 74;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const max = Math.max(...chart.values, 1);
  const points = chart.values.map((value, index) => {
    const x = left + (chart.values.length === 1 ? plotWidth / 2 : (index / (chart.values.length - 1)) * plotWidth);
    const y = top + plotHeight - (value / max) * plotHeight;
    return { x, y, value };
  });
  const grid = [0, .25, .5, .75, 1]
    .map((ratio) => {
      const y = top + plotHeight - ratio * plotHeight;
      const label = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(max * ratio);
      return `<line class="chart-grid" x1="${left}" x2="${width - right}" y1="${y}" y2="${y}" /><text class="chart-axis" x="${left - 10}" y="${y + 4}" text-anchor="end">${escapeHtml(label)}</text>`;
    })
    .join("");
  const labels = chart.labels
    .map((label, index) => {
      const x = points[index]?.x ?? left;
      const short = label.length > 14 ? `${label.slice(0, 13)}...` : label;
      return `<text class="chart-axis" x="${x}" y="${height - 34}" text-anchor="middle">${escapeHtml(short)}</text>`;
    })
    .join("");
  const marks =
    chart.type === "line"
      ? `<polyline class="chart-line" points="${points.map((point) => `${point.x},${point.y}`).join(" ")}" />${points
          .map((point) => `<circle class="chart-point" cx="${point.x}" cy="${point.y}" r="6" />`)
          .join("")}`
      : points
          .map((point, index) => {
            const step = plotWidth / chart.values.length;
            const barWidth = Math.max(24, step * .62);
            const barHeight = Math.max(2, top + plotHeight - point.y);
            return `<rect class="chart-bar" x="${point.x - barWidth / 2}" y="${point.y}" width="${barWidth}" height="${barHeight}" rx="4" /><text class="chart-value" x="${point.x}" y="${point.y - 9}" text-anchor="middle">${escapeHtml(formatChartValue(chart.values[index] ?? 0))}</text>`;
          })
          .join("");
  return `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeAttribute(chart.title)}"><title>${escapeHtml(chart.title)}</title>${grid}${marks}${labels}<text class="chart-axis" x="${width - right}" y="${height - 8}" text-anchor="end">${escapeHtml(chart.valueLabel)}</text></svg>`;
}

function formatChartValue(value: number): string {
  return new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function transitionForSlide(request: DeckRequest, index: number): SlideTransition {
  const perSlide = request.slideTransitions?.[index];
  if (perSlide) {
    return perSlide;
  }
  if (request.transition && request.transition !== "varied") {
    return request.transition;
  }
  const varied: SlideTransition[] = ["fade", "slide", "zoom", "slide"];
  return varied[index % varied.length]!;
}

function visualPlacementClass(placement: ImagePlacement = "right"): string {
  if (placement === "left") {
    return "has-visual visual-left";
  }
  if (placement === "background") {
    return "has-visual visual-background";
  }
  if (placement === "full") {
    return "has-visual visual-full";
  }
  return "has-visual visual-right";
}

function shouldContainAsset(asset: DeckAsset): boolean {
  return asset.source === "user" || asset.source === "editable sample";
}

function headingSizeClass(title: string): string {
  if (title.length > 74) {
    return "heading-extra-long";
  }
  if (title.length > 48) {
    return "heading-long";
  }
  return "";
}

function chooseAsset(slide: SlidePlan, assets: DeckAsset[], index: number): DeckAsset | undefined {
  if (!assets.length) {
    return undefined;
  }
  const slideAsset = assets.find((asset) => asset.slideIndex === index);
  if (slideAsset) {
    return slideAsset;
  }

  const query = (slide.imageQuery || slide.visualPrompt || slide.title).toLowerCase();
  const queryWords = query.split(/\W+/).filter((word) => word.length > 3);
  if (!queryWords.length) {
    return undefined;
  }

  return assets.find((asset) => {
    const haystack = `${asset.title} ${asset.creator ?? ""} ${asset.source ?? ""}`.toLowerCase();
    return queryWords.some((word) => haystack.includes(word));
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

export function deckFilename(title: string): string {
  return sanitizeFilename(title.toLowerCase().replace(/\s+/g, "-")).slice(0, 72) || "deck";
}

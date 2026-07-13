import { describe, expect, it } from "vitest";
import { deckPlanFromHtml, exportDeckToPptx } from "../src/services/pptxExport.js";
import type { DeckPlan, DeckRequest } from "../src/types.js";

const plan: DeckPlan = {
  title: "Quarterly Review",
  subtitle: "Source-backed performance",
  presenters: ["Team"],
  narrative: "Review performance and actions.",
  sources: [],
  recommendedFollowups: [],
  slides: [
    { title: "Quarterly Review", layout: "title", bullets: [] },
    { title: "Original insight", layout: "bullets", bullets: ["Original point"], dataCitation: "Source: sales.csv, Sheet: Revenue" },
    { title: "Thank You", layout: "closing", bullets: [] }
  ]
};

const request: DeckRequest = {
  topic: plan.title,
  title: plan.title,
  presenters: [],
  audience: "executives",
  slideCount: 3,
  tone: "executive",
  brandStyle: "executive-clean",
  useSlackContext: false,
  useWebResearch: false,
  useLicensedImages: false,
  includeCitations: true,
  includeSpeakerNotes: true,
  includeVideoLinks: false
};

const editedHtml = `<!doctype html><html><body>
<article class="slide" data-slide-id="slide-1"><h1>Quarterly Review</h1></article>
<article class="slide" data-slide-id="slide-2"><h2>Edited insight</h2><p class="subtitle">Updated context</p><ul><li>Updated point</li></ul><footer class="citation">Source: sales.csv, Sheet: Revenue</footer></article>
<article class="slide" data-slide-id="slide-3"><h2>Thank You</h2></article>
</body></html>`;

describe("PPTX export", () => {
  it("uses current editor text when constructing the export plan", () => {
    const updated = deckPlanFromHtml(editedHtml, plan);
    expect(updated.slides[1]).toMatchObject({ title: "Edited insight", subtitle: "Updated context", bullets: ["Updated point"] });
    expect(updated.slides[1]?.dataCitation).toContain("sales.csv");
  });

  it("produces a non-empty Office Open XML presentation", async () => {
    const result = await exportDeckToPptx({ deckId: "123-exportTest", plan, request, html: editedHtml });
    expect(result.filename).toMatch(/quarterly-review-123-exportTest\.pptx$/);
    expect(result.buffer.length).toBeGreaterThan(20_000);
    expect(result.buffer.subarray(0, 2).toString("ascii")).toBe("PK");
    expect(result.buffer.includes(Buffer.from("[Content_Types].xml"))).toBe(true);
    expect(result.buffer.includes(Buffer.from("ppt/presentation.xml"))).toBe(true);
  });
});

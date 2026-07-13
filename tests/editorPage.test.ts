import { describe, expect, it } from "vitest";
import { hasRemovableImageInSlideHtml, renderEditorPage } from "../src/editor/page.js";

describe("editor image controls", () => {
  it("enables removal only for a real non-chart slide image", () => {
    const html = `<!doctype html><html><body>
      <article class="slide"><h2>Text only</h2></article>
      <article class="slide"><figure class="visual chart-visual"><svg></svg></figure></article>
      <article class="slide"><figure class="visual visual-contain"><img src="/decks/123-test/assets/photo.png" alt="Photo" /></figure></article>
    </body></html>`;
    expect(hasRemovableImageInSlideHtml(html, 1)).toBe(false);
    expect(hasRemovableImageInSlideHtml(html, 2)).toBe(false);
    expect(hasRemovableImageInSlideHtml(html, 3)).toBe(true);
  });

  it("wires selected-slide refresh and alt-text editing into the page", () => {
    const page = renderEditorPage("123-editorTest");
    expect(page).toContain(".visual:not(.chart-visual) img");
    expect(page).toContain("loadSelectedSlideControls");
    expect(page).toContain("designImageAlt");
    expect(page).toContain("selectedSlide: Number(document.getElementById('imageSlide').value)");
  });
});

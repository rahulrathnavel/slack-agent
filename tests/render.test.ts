import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderDeckSite } from "../src/deck/render.js";
import type { DeckPlan, DeckRequest } from "../src/types.js";

describe("renderDeckSite", () => {
  it("writes a navigable static deck", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pioltppt-"));
    const request: DeckRequest = {
      topic: "Customer onboarding",
      title: "Customer onboarding",
      presenters: ["Team"],
      audience: "customers",
      slideCount: 3,
      tone: "friendly",
      brandStyle: "executive-clean",
      useSlackContext: false,
      useWebResearch: false,
      useLicensedImages: false,
      includeCitations: true,
      includeSpeakerNotes: true,
      includeVideoLinks: false
    };
    const plan: DeckPlan = {
      title: "Customer onboarding",
      subtitle: "A simple enablement plan",
      presenters: ["Team"],
      narrative: "Explain the onboarding path.",
      recommendedFollowups: [],
      sources: [],
      slides: [
        { title: "Customer onboarding", layout: "title", bullets: [] },
        { title: "First value", layout: "bullets", bullets: ["Define the moment", "Remove friction"] },
        { title: "Next steps", layout: "closing", bullets: ["Agree owner", "Schedule review"] }
      ]
    };

    await renderDeckSite({
      deckId: "test",
      outputDir: dir,
      publicUrl: "http://localhost/decks/test/",
      plan,
      request,
      assets: [],
      sources: []
    });

    const html = await fs.readFile(path.join(dir, "index.html"), "utf8");
    const manifest = await fs.readFile(path.join(dir, "deck.json"), "utf8");
    expect(html).toContain("Customer onboarding");
    expect(html).toContain("Deck controls");
    expect(JSON.parse(manifest).deckId).toBe("test");
  });
});

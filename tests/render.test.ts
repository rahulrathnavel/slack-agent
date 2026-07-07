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
    expect(html).toContain("transition-fade");
    expect(html).toContain("transition-slide");
    expect(html).toContain("transition-zoom");
    expect(html).not.toContain("<figure class=\"visual\"");
    expect(JSON.parse(manifest).deckId).toBe("test");
  });

  it("renders content-only slides unless a user image is assigned", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pioltppt-"));
    const request: DeckRequest = {
      topic: "Anger",
      title: "Anger",
      presenters: [],
      audience: "general",
      slideCount: 3,
      tone: "educational",
      brandStyle: "dark-stage",
      useSlackContext: false,
      useWebResearch: false,
      useLicensedImages: false,
      includeCitations: true,
      includeSpeakerNotes: true,
      includeVideoLinks: false,
      transition: "fade",
      slideTransitions: { 1: "zoom" }
    };
    const plan: DeckPlan = {
      title: "Anger",
      subtitle: "A practical overview",
      presenters: [],
      narrative: "Explain anger.",
      recommendedFollowups: [],
      sources: [],
      slides: [
        { title: "Anger", layout: "title", bullets: [] },
        { title: "Recognize the Signal", layout: "bullets", bullets: ["Anger points to a boundary or unmet need"] },
        { title: "Thank You", layout: "closing", bullets: ["Use the signal wisely"] }
      ]
    };

    await renderDeckSite({
      deckId: "test-images",
      outputDir: dir,
      publicUrl: "http://localhost/decks/test-images/",
      plan,
      request,
      assets: [
        {
          title: "User image for slide 2",
          url: "https://example.com/anger.png",
          thumbnailUrl: "https://example.com/anger.png",
          source: "user",
          slideIndex: 1,
          placement: "left"
        }
      ],
      sources: []
    });

    const html = await fs.readFile(path.join(dir, "index.html"), "utf8");
    expect(html).toContain("transition-fade");
    expect(html).toContain("transition-zoom");
    expect(html).toContain("visual-left");
    expect(html).toContain("https://example.com/anger.png");
    expect(html).not.toContain("placeholder");
  });
});

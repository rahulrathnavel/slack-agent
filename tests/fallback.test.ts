import { describe, expect, it } from "vitest";
import { createFallbackPlan, parseAdvancedControls } from "../src/agent/deckAgent.js";
import type { DeckRequest, ResearchSource } from "../src/types.js";

describe("source-grounded fallback", () => {
  it("uses retrieved evidence instead of visible presentation instructions", () => {
    const request: DeckRequest = {
      topic: "Kaggle overview",
      title: "Kaggle overview",
      presenters: [],
      audience: "general",
      slideCount: 4,
      tone: "educational",
      brandStyle: "executive-clean",
      useSlackContext: false,
      useWebResearch: true,
      useLicensedImages: false,
      includeCitations: true,
      includeSpeakerNotes: true,
      includeVideoLinks: false
    };
    const sources: ResearchSource[] = [
      {
        title: "Kaggle: Your Machine Learning and Data Science Community",
        url: "https://www.kaggle.com/",
        sourceType: "web",
        snippet:
          "Kaggle is an online community for data scientists and machine learning practitioners. It provides public datasets, hosted notebooks, competitions, and learning resources."
      },
      {
        title: "Kaggle competitions",
        url: "https://www.kaggle.com/competitions",
        sourceType: "web",
        snippet:
          "Competitions let participants solve defined data problems and compare results on shared leaderboards. Teams can test techniques against consistent evaluation metrics."
      }
    ];

    const plan = createFallbackPlan(request, sources);
    const visibleText = plan.slides.flatMap((slide) => [slide.title, ...slide.bullets]).join(" ");
    expect(plan.slides).toHaveLength(5);
    expect(plan.slides.at(-1)?.title).toBe("Thank You");
    expect(visibleText).toContain("public datasets");
    expect(visibleText).toContain("shared leaderboards");
    expect(visibleText).not.toContain("central theme of this presentation");
    expect(visibleText).not.toContain("Use relevant examples");
  });

  it("keeps a Kaggle deck useful when external research is unavailable", () => {
    const request: DeckRequest = {
      topic: "Kaggle overview",
      title: "Kaggle overview",
      presenters: [],
      audience: "general",
      slideCount: 4,
      tone: "educational",
      brandStyle: "executive-clean",
      useSlackContext: false,
      useWebResearch: true,
      useLicensedImages: false,
      includeCitations: false,
      includeSpeakerNotes: true,
      includeVideoLinks: false
    };

    const plan = createFallbackPlan(request, []);
    const visibleText = plan.slides.flatMap((slide) => [slide.title, ...slide.bullets]).join(" ");
    expect(visibleText).toContain("browser-based notebooks");
    expect(visibleText).toContain("leaderboards");
    expect(visibleText).not.toContain("central theme of this presentation");
  });
});

describe("advanced image controls", () => {
  it("does not create a dummy image when no URL is supplied", () => {
    const request: DeckRequest = {
      topic: "Kaggle overview",
      presenters: [],
      audience: "general",
      slideCount: 4,
      tone: "educational",
      brandStyle: "executive-clean",
      useSlackContext: false,
      useWebResearch: false,
      useLicensedImages: false,
      includeCitations: false,
      includeSpeakerNotes: true,
      includeVideoLinks: false,
      advancedPrompt: "slide 2: image right | slide 3: no image"
    };

    const controls = parseAdvancedControls(request);
    expect(controls.assets).toHaveLength(0);
  });
});

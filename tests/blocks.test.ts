import { describe, expect, it } from "vitest";
import { quickDraftRequest } from "../src/slack/blocks.js";

describe("quickDraftRequest", () => {
  it("keeps a normal slash command text-only with varied transitions", () => {
    const request = quickDraftRequest("Launch a presentation about customer trust", "U123");

    expect(request.topic).toBe("customer trust");
    expect(request.useLicensedImages).toBe(false);
    expect(request.advancedPrompt).toBeUndefined();
  });

  it("separates pipe-delimited image and transition controls from the topic", () => {
    const request = quickDraftRequest(
      "Product roadmap | slide 2: image right https://example.com/roadmap.png | slide 3: no image | transition: fade",
      "U123"
    );

    expect(request.topic).toBe("Product roadmap");
    expect(request.advancedPrompt).toContain("slide 2: image right https://example.com/roadmap.png");
    expect(request.advancedPrompt).toContain("slide 3: no image");
    expect(request.advancedPrompt).toContain("transition: fade");
  });
});

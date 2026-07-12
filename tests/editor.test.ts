import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WebClient } from "@slack/web-api";
import { config } from "../src/config.js";
import { mountEditorRoutes } from "../src/editor/routes.js";
import { editorTokenFor } from "../src/editor/security.js";
import { NvidiaClient } from "../src/services/nvidia.js";

const deckId = `${Date.now()}-editorTest`;
const deckDir = path.join(config.decksDir, deckId);
const draftPath = path.join(config.editorDraftsDir, `${deckId}.html`);
const baseHtml = "<!doctype html><html><body><h1>Original title</h1><p>Original copy</p></body></html>";
const slideHtml = `<!doctype html><html><body>
<article class="slide transition-slide has-visual visual-left">
  <div class="content"><h2>Slide one</h2><ul class="bullets"><li>First point</li><li>Second point</li></ul></div>
  <figure class="visual"><img src="/sample.jpg" alt="Sample" /></figure>
</article>
</body></html>`;
let server: Server;
let baseUrl: string;
let lastTargetedPrompt = "";
let lastTargetedUserPayload = "";

class FakeNvidia extends NvidiaClient {
  override async chatText(messages?: { content: string }[]): Promise<string> {
    const prompt = messages?.map((message) => message.content).join("\n") ?? "";
    if (prompt.includes("Current slide blocks")) {
      lastTargetedPrompt = prompt;
      lastTargetedUserPayload = messages?.at(-1)?.content ?? "";
      const article = slideHtml.match(/<article[\s\S]*<\/article>/)?.[0] ?? "";
      if (prompt.includes("https://example.com/logo.png")) {
        return JSON.stringify({
          slides: [
            {
              slideNumber: 1,
              html: article
                .replace(
                  '<article class="slide transition-slide has-visual visual-left">',
                  '<article class="slide transition-slide has-visual visual-right" style="grid-template-columns: minmax(0, 1fr) minmax(220px, .48fr); grid-template-rows: minmax(0, 1fr); align-items: center;">'
                )
                .replace(
                  '<figure class="visual"><img src="/sample.jpg" alt="Sample" /></figure>',
                  '<figure class="visual visual-contain" style="height: min(46vh, 390px); max-height: 390px; align-self: center;"><img src="https://example.com/logo.png" alt="Example logo" loading="lazy" style="width: 100%; height: 100%; object-fit: contain; object-position: center; padding: clamp(14px, 3vw, 36px); background: #fff;" /></figure>'
                )
            }
          ],
          summary: "Added and fitted the image on slide 1."
        });
      }
      return JSON.stringify({
        slides: [
          {
            slideNumber: 1,
            html: article.replace("<li>Second point</li>", "<li>AI rewritten point</li>")
          }
        ],
        summary: "Updated slide 1 only."
      });
    }
    return baseHtml.replace("Original copy", "AI updated copy");
  }
}

describe("deck editor routes", () => {
  beforeAll(async () => {
    await fs.mkdir(deckDir, { recursive: true });
    await fs.mkdir(config.editorDraftsDir, { recursive: true });
    await fs.writeFile(path.join(deckDir, "index.html"), baseHtml, "utf8");
    await fs.writeFile(
      path.join(deckDir, "deck.json"),
      JSON.stringify({
        publicUrl: `https://example.com/decks/${deckId}/`,
        plan: { title: "Original title", slides: [] },
        request: { presenters: [] }
      }),
      "utf8"
    );
    const app = express();
    mountEditorRoutes(app, {} as WebClient, new FakeNvidia());
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("Test server did not bind");
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await fs.rm(deckDir, { recursive: true, force: true });
    await fs.rm(draftPath, { force: true });
    await fs.rm(path.join(config.editorRevisionsDir, deckId), { recursive: true, force: true });
  });

  it("protects source access and keeps drafts separate from the live deck", async () => {
    const unauthorized = await fetch(`${baseUrl}/api/editor/${deckId}/source`);
    expect(unauthorized.status).toBe(401);

    const headers = { Authorization: `Bearer ${editorTokenFor(deckId)}` };
    const source = await fetch(`${baseUrl}/api/editor/${deckId}/source`, { headers });
    expect(await source.json()).toMatchObject({ html: baseHtml, isDraft: false });

    const draftHtml = baseHtml.replace("Original copy", "Manual draft copy");
    const saved = await fetch(`${baseUrl}/api/editor/${deckId}/save`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ html: draftHtml })
    });
    expect(saved.status).toBe(200);
    expect(await fs.readFile(path.join(deckDir, "index.html"), "utf8")).toBe(baseHtml);

    const draft = await fetch(`${baseUrl}/api/editor/${deckId}/source`, { headers });
    expect(await draft.json()).toMatchObject({ html: draftHtml, isDraft: true });
  });

  it("applies AI HTML edits and publishes the finished source", async () => {
    const headers = {
      Authorization: `Bearer ${editorTokenFor(deckId)}`,
      "Content-Type": "application/json"
    };
    const edited = await fetch(`${baseUrl}/api/editor/${deckId}/ai`, {
      method: "POST",
      headers,
      body: JSON.stringify({ html: baseHtml, instruction: "Update the paragraph" })
    });
    const editedBody = (await edited.json()) as { html: string };
    expect(editedBody.html).toContain("AI updated copy");

    const upload = await fetch(`${baseUrl}/api/editor/${deckId}/upload`, {
      method: "POST",
      headers: { Authorization: headers.Authorization, "Content-Type": "image/png" },
      body: Buffer.from([137, 80, 78, 71])
    });
    const uploadBody = (await upload.json()) as { url: string };
    expect(upload.status).toBe(200);
    expect(uploadBody.url).toMatch(new RegExp(`^/decks/${deckId}/assets/.+\\.png$`));

    const published = await fetch(`${baseUrl}/api/editor/${deckId}/publish`, {
      method: "POST",
      headers,
      body: JSON.stringify({ html: editedBody.html })
    });
    expect(await published.json()).toMatchObject({ ok: true, title: "Original title", notified: false });
    expect(await fs.readFile(path.join(deckDir, "index.html"), "utf8")).toContain("AI updated copy");
    expect((await fs.readdir(path.join(config.editorRevisionsDir, deckId))).length).toBe(1);
  });

  it("handles common editor prompts without waiting for the model", async () => {
    const headers = {
      Authorization: `Bearer ${editorTokenFor(deckId)}`,
      "Content-Type": "application/json"
    };
    const moved = await fetch(`${baseUrl}/api/editor/${deckId}/ai`, {
      method: "POST",
      headers,
      body: JSON.stringify({ html: slideHtml, instruction: "make the image arranged in right side of the slide" })
    });
    const movedBody = (await moved.json()) as { html: string; summary: string };
    expect(movedBody.summary).toContain("Moved slide 1 image to the right");
    expect(movedBody.html).toContain("visual-right");
    expect(movedBody.html).not.toContain("visual-left");

    const reduced = await fetch(`${baseUrl}/api/editor/${deckId}/ai`, {
      method: "POST",
      headers,
      body: JSON.stringify({ html: movedBody.html, instruction: "make the slide 1 to one single point alone" })
    });
    const reducedBody = (await reduced.json()) as { html: string; summary: string };
    expect(reducedBody.summary).toContain("Kept one main point");
    expect(reducedBody.html).toContain("<li>First point</li>");
    expect(reducedBody.html).not.toContain("<li>Second point</li>");

    const imageAdded = await fetch(`${baseUrl}/api/editor/${deckId}/ai`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        html: baseHtml.replace("</body>", `${slideHtml.match(/<article[\s\S]*<\/article>/)?.[0]}</body>`),
        instruction: "make slide 1 include this image https://example.com/logo.png into right side"
      })
    });
    const imageBody = (await imageAdded.json()) as { html: string; summary: string };
    expect(imageBody.summary).toContain("Added and fitted the image");
    expect(imageBody.html).toContain('src="https://example.com/logo.png"');
    expect(imageBody.html).toContain("visual-right");
    expect(imageBody.html).toContain("visual-contain");
    expect(imageBody.html).toContain("object-fit: contain");
    expect(imageBody.html).toContain("grid-template-columns: minmax(0, 1fr) minmax(220px, .48fr)");
    expect(lastTargetedPrompt).toContain("Current slide blocks");
    expect(lastTargetedUserPayload).toContain("<article");
    expect(lastTargetedUserPayload).not.toContain("<!doctype html>");
    expect(lastTargetedUserPayload).not.toContain("<html");

    const repaired = await fetch(`${baseUrl}/api/editor/${deckId}/ai`, {
      method: "POST",
      headers,
      body: JSON.stringify({ html: movedBody.html, instruction: "make the slide 1 image fully visible" })
    });
    const repairedBody = (await repaired.json()) as { html: string; summary: string };
    expect(repairedBody.summary).toContain("fully visible");
    expect(repairedBody.html).toContain("visual-contain");
    expect(repairedBody.html).toContain("object-fit: contain");
  });

  it("sends only target slide blocks to the model and replaces those blocks", async () => {
    const headers = {
      Authorization: `Bearer ${editorTokenFor(deckId)}`,
      "Content-Type": "application/json"
    };
    const edited = await fetch(`${baseUrl}/api/editor/${deckId}/ai`, {
      method: "POST",
      headers,
      body: JSON.stringify({ html: slideHtml, instruction: "make slide 1 more polished" })
    });
    const editedBody = (await edited.json()) as { html: string; summary: string };
    expect(editedBody.summary).toBe("Updated slide 1 only.");
    expect(editedBody.html).toContain("AI rewritten point");
    expect(editedBody.html).toContain("<article");
    expect(editedBody.html).toContain("</html>");
  });
});

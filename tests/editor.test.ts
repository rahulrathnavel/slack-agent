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
let server: Server;
let baseUrl: string;

class FakeNvidia extends NvidiaClient {
  override async chatText(): Promise<string> {
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
});

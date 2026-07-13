import express, { type Application, type Request, type Response } from "express";
import { DeckAgent } from "../agent/deckAgent.js";
import { config } from "../config.js";
import { isValidWorkspaceToken } from "../editor/security.js";
import { logger } from "../logger.js";
import { searchSlackContext } from "../services/slackSearch.js";
import { asDataFile, getUpload, storeUpload } from "../services/uploads.js";
import type { Audience, BrandStyle, DataFileInput, DeckRequest, Tone } from "../types.js";
import { renderWorkspacePage } from "./page.js";

const USER_ID_PATTERN = /^[A-Z0-9]{3,32}$/i;

export function mountWorkspaceRoutes(app: Application, agent: DeckAgent): void {
  app.get("/workspace/:userId", (req, res) => {
    const userId = safeUserId(req.params.userId);
    const token = stringValue(req.query.token);
    if (!userId || !token || !isValidWorkspaceToken(userId, token)) {
      res.status(401).type("html").send("This Data Studio link is invalid or expired. Open a new one from Slack.");
      return;
    }
    res.type("html").send(renderWorkspacePage(userId));
  });

  const api = express.Router();
  api.use("/:userId", (req, res, next) => {
    const userId = safeUserId(req.params.userId);
    const token = stringValue(req.query.token);
    if (!userId || !token || !isValidWorkspaceToken(userId, token)) {
      res.status(401).json({ error: "This Data Studio link is invalid or expired." });
      return;
    }
    res.locals.userId = userId;
    next();
  });

  api.post("/:userId/upload", express.raw({ type: "*/*", limit: "20mb" }), async (req, res) => {
    try {
      const name = decodeURIComponent(String(req.header("x-file-name") ?? "upload"));
      if (!Buffer.isBuffer(req.body)) throw new Error("No file was received.");
      const upload = await storeUpload({
        ownerId: res.locals.userId as string,
        name,
        buffer: req.body,
        mime: req.header("content-type") ?? undefined,
        source: "upload"
      });
      res.json({ upload: publicUpload(upload) });
    } catch (error) {
      sendError(res, error);
    }
  });

  api.post("/:userId/generate", express.json({ limit: "1mb" }), async (req, res) => {
    try {
      const ownerId = res.locals.userId as string;
      const fileIds = Array.isArray(req.body?.fileIds) ? req.body.fileIds.map(String) : [];
      const uploads = await Promise.all(fileIds.map((id: string) => getUpload(ownerId, id)));
      const dataFiles = uploads
        .map((upload) => (upload ? asDataFile(upload) : undefined))
        .filter((file): file is DataFileInput => Boolean(file));
      if (!dataFiles.length) throw new Error("Upload at least one CSV or XLSX file.");
      const templateId = typeof req.body?.templateFileId === "string" ? req.body.templateFileId : undefined;
      const template = templateId ? await getUpload(ownerId, templateId) : undefined;
      if (template && template.kind !== "pdf" && template.kind !== "pptx") throw new Error("Templates must be PDF or PPTX files.");
      const templateKind = template?.kind === "pdf" || template?.kind === "pptx" ? template.kind : undefined;
      const request = workspaceRequest(req, ownerId, dataFiles, template?.id, templateKind);
      const deck = await agent.generate(request, { botToken: config.SLACK_BOT_TOKEN, allowConfiguredUserToken: false });
      res.json({ title: deck.title, publicUrl: deck.publicUrl, editorUrl: deck.editorUrl, deckId: deck.deckId });
    } catch (error) {
      sendError(res, error);
    }
  });

  api.post("/:userId/research", express.json({ limit: "256kb" }), async (req, res) => {
    try {
      const query = stringValue(req.body?.query);
      if (!query) throw new Error("Add a Slack question to search.");
      const fromDate = stringValue(req.body?.fromDate);
      const toDate = stringValue(req.body?.toDate);
      validateDateRange(fromDate, toDate);
      const result = await searchSlackContext({
        query,
        botToken: config.SLACK_BOT_TOKEN,
        fromDate,
        toDate,
        person: stringValue(req.body?.person),
        allowConfiguredUserToken: false
      });
      res.json({
        sources: result.sources.slice(0, 12),
        summary: summarizeSlackEvidence(query, result),
        unavailableReason: result.unavailableReason
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.use("/api/workspace", api);
}

function workspaceRequest(req: Request, ownerId: string, dataFiles: NonNullable<DeckRequest["dataFiles"]>, templateFileId?: string, templateKind?: "pdf" | "pptx"): DeckRequest {
  const title = String(req.body?.title ?? "").trim();
  if (!title) throw new Error("Add a title or question for the data deck.");
  const slackResearch = req.body?.slackResearch && typeof req.body.slackResearch === "object" ? {
    query: stringValue(req.body.slackResearch.query),
    person: stringValue(req.body.slackResearch.person),
    fromDate: stringValue(req.body.slackResearch.fromDate),
    toDate: stringValue(req.body.slackResearch.toDate)
  } : undefined;
  return {
    topic: title,
    title,
    presenters: [],
    audience: "executives" as Audience,
    slideCount: Math.max(4, Math.min(8, Number(req.body?.slideCount) || 5)),
    tone: "executive" as Tone,
    brandStyle: validStyle(req.body?.brandStyle),
    useSlackContext: Boolean(slackResearch?.query),
    useWebResearch: false,
    useLicensedImages: false,
    includeCitations: true,
    includeSpeakerNotes: true,
    includeVideoLinks: false,
    customContext: stringValue(req.body?.prompt),
    requesterUserId: ownerId,
    dataFiles,
    templateFileId,
    templateKind,
    slackResearch
  };
}

function validStyle(value: unknown): BrandStyle {
  return ["executive-clean", "startup-bright", "editorial", "dark-stage", "minimal"].includes(String(value))
    ? (value as BrandStyle)
    : "executive-clean";
}

function publicUpload(upload: Awaited<ReturnType<typeof storeUpload>>): Pick<Awaited<ReturnType<typeof storeUpload>>, "id" | "name" | "kind"> {
  return { id: upload.id, name: upload.name, kind: upload.kind };
}

function safeUserId(value: string | undefined): string | undefined {
  return value && USER_ID_PATTERN.test(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function validateDateRange(fromDate?: string, toDate?: string): void {
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  if (fromDate && !isoDate.test(fromDate)) throw new Error("Use a valid from date in YYYY-MM-DD format.");
  if (toDate && !isoDate.test(toDate)) throw new Error("Use a valid to date in YYYY-MM-DD format.");
  if (fromDate && toDate && fromDate > toDate) throw new Error("The Slack from date must be on or before the to date.");
}

function sendError(res: Response, error: unknown): void {
  logger.warn({ error }, "Data Studio request failed");
  res.status(400).json({ error: error instanceof Error ? error.message : "Data Studio could not complete that request." });
}

function summarizeSlackEvidence(query: string, result: Awaited<ReturnType<typeof searchSlackContext>>): string {
  if (result.unavailableReason) {
    return `Slack evidence is unavailable: ${result.unavailableReason}`;
  }
  if (!result.sources.length) {
    return `No accessible Slack messages were found for "${query}".`;
  }
  const first = result.sources[0]!;
  const date = first.publishedDate ? ` around ${first.publishedDate.slice(0, 10)}` : "";
  const channel = first.title.replace(/^Slack:\s*/i, "");
  return `Found ${result.sources.length} accessible Slack evidence item${result.sources.length === 1 ? "" : "s"} for "${query}". Most relevant match: ${channel}${date}.`;
}

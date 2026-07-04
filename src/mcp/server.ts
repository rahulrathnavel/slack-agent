import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Application, Request, Response } from "express";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { DeckAgent } from "../agent/deckAgent.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { searchLicensedImages } from "../services/openverse.js";
import { searchWeb } from "../services/tavily.js";
import type { Audience, BrandStyle, DeckRequest, Tone } from "../types.js";
import { verifySlackSignature } from "../slack/signature.js";

const transports: Record<string, StreamableHTTPServerTransport> = {};

const audienceEnum = ["executives", "sales", "engineering", "customers", "investors", "training", "general"] as const;
const toneEnum = ["executive", "persuasive", "technical", "friendly", "bold", "educational"] as const;
const styleEnum = ["executive-clean", "startup-bright", "editorial", "dark-stage", "minimal"] as const;

export function createMcpServer(agent = new DeckAgent()): McpServer {
  const server = new McpServer(
    {
      name: "PioltPPT",
      version: "0.1.0"
    },
    {
      capabilities: {
        logging: {}
      }
    }
  );

  server.registerTool(
    "create_presentation_site",
    {
      title: "Create presentation site",
      description:
        "Create a public live presentation website from a topic, Slack context preference, web research preference, and optional custom notes.",
      inputSchema: {
        topic: z.string().min(3).describe("The deck topic, title, or rough prompt."),
        presenters: z.array(z.string()).default([]).describe("Presenter names."),
        audience: z.enum(audienceEnum).default("executives"),
        slideCount: z.number().int().min(3).max(12).default(7),
        tone: z.enum(toneEnum).default("executive"),
        brandStyle: z.enum(styleEnum).default("executive-clean"),
        useSlackContext: z.boolean().default(false),
        useWebResearch: z.boolean().default(true),
        useLicensedImages: z.boolean().default(true),
        includeCitations: z.boolean().default(true),
        includeSpeakerNotes: z.boolean().default(true),
        includeVideoLinks: z.boolean().default(false),
        customContext: z.string().optional(),
        assetLinks: z.string().optional(),
        advancedPrompt: z.string().optional()
      }
    },
    async (input) => {
      const request: DeckRequest = {
        topic: input.topic,
        title: input.topic,
        presenters: input.presenters,
        audience: input.audience as Audience,
        slideCount: input.slideCount,
        tone: input.tone as Tone,
        brandStyle: input.brandStyle as BrandStyle,
        useSlackContext: input.useSlackContext,
        useWebResearch: input.useWebResearch,
        useLicensedImages: input.useLicensedImages,
        includeCitations: input.includeCitations,
        includeSpeakerNotes: input.includeSpeakerNotes,
        includeVideoLinks: input.includeVideoLinks,
        customContext: input.customContext,
        assetLinks: input.assetLinks,
        advancedPrompt: input.advancedPrompt
      };
      const deck = await agent.generate(request);
      return {
        content: [
          {
            type: "text",
            text: `Created ${deck.title}\n${deck.publicUrl}\nSources: ${deck.sources.length}\nAssets: ${deck.assets.length}`
          }
        ]
      };
    }
  );

  server.registerTool(
    "revise_presentation_site",
    {
      title: "Revise presentation site",
      description: "Revise an existing PioltPPT live presentation website in place.",
      inputSchema: {
        deckId: z.string().min(1),
        instruction: z.string().min(3)
      }
    },
    async ({ deckId, instruction }) => {
      const deck = await agent.revise(deckId, instruction);
      return {
        content: [
          {
            type: "text",
            text: `Revised ${deck.title}\n${deck.publicUrl}`
          }
        ]
      };
    }
  );

  server.registerTool(
    "search_web",
    {
      title: "Search web",
      description: "Search the web using Tavily and return concise source metadata for deck grounding.",
      inputSchema: {
        query: z.string().min(2),
        maxResults: z.number().int().min(1).max(10).default(5)
      }
    },
    async ({ query, maxResults }) => {
      const results = await searchWeb(query, maxResults);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(results, null, 2)
          }
        ]
      };
    }
  );

  server.registerTool(
    "search_licensed_assets",
    {
      title: "Search licensed assets",
      description: "Search Openverse for licensed image assets with attribution data.",
      inputSchema: {
        query: z.string().min(2),
        count: z.number().int().min(1).max(10).default(5)
      }
    },
    async ({ query, count }) => {
      const results = await searchLicensedImages(query, count);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(results, null, 2)
          }
        ]
      };
    }
  );

  server.registerTool(
    "get_deck_manifest",
    {
      title: "Get deck manifest",
      description: "Read the generated deck manifest JSON for a deck ID.",
      inputSchema: {
        deckId: z.string().min(1)
      }
    },
    async ({ deckId }) => {
      const filePath = path.join(config.decksDir, deckId, "deck.json");
      const manifest = await fs.readFile(filePath, "utf8");
      return {
        content: [
          {
            type: "text",
            text: manifest
          }
        ]
      };
    }
  );

  return server;
}

export function mountMcpRoutes(app: Application, agent = new DeckAgent()): void {
  app.post("/mcp", express.raw({ type: "*/*", limit: "4mb" }), async (req: Request, res: Response) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : JSON.stringify(req.body ?? {});
    const signature = req.headers["x-slack-signature"];
    const timestamp = req.headers["x-slack-request-timestamp"];
    const signedBySlack = Boolean(signature && timestamp);

    if ((config.MCP_REQUIRE_SLACK_SIGNATURE || signedBySlack) && !verifySlackSignature({
      signingSecret: config.SLACK_SIGNING_SECRET,
      rawBody,
      signature,
      timestamp
    })) {
      res.status(401).json({ error: "Invalid Slack signature" });
      return;
    }

    let body: unknown;
    try {
      body = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      res.status(400).json({ error: "Invalid JSON" });
      return;
    }

    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport: StreamableHTTPServerTransport | undefined;

      if (sessionId && transports[sessionId]) {
        transport = transports[sessionId];
      } else if (!sessionId && isInitializeRequest(body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: (newSessionId) => {
            transports[newSessionId] = transport as StreamableHTTPServerTransport;
          }
        });

        transport.onclose = () => {
          if (transport?.sessionId) {
            delete transports[transport.sessionId];
          }
        };

        const server = createMcpServer(agent);
        await server.connect(transport);
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: no valid MCP session ID"
          },
          id: null
        });
        return;
      }

      await transport.handleRequest(req, res, body);
    } catch (error) {
      logger.error({ error }, "MCP request failed");
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error"
          },
          id: null
        });
      }
    }
  });

  app.get("/mcp", (_req, res) => {
    res.status(405).set("Allow", "POST").send("Method Not Allowed");
  });
}

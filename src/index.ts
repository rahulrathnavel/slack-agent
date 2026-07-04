import path from "node:path";
import express from "express";
import { pinoHttp } from "pino-http";
import { DeckAgent } from "./agent/deckAgent.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { mountMcpRoutes } from "./mcp/server.js";
import { createSlackApp, slackManifest, writeManifestFile } from "./slack/app.js";
import { ensureDirectories } from "./storage/files.js";

async function main(): Promise<void> {
  await ensureDirectories([config.dataDir, config.installationDir, config.publicDir, config.decksDir]);

  const agent = new DeckAgent();
  const { app: slackApp, receiver } = createSlackApp(agent);

  receiver.app.use(
    pinoHttp({
      logger,
      autoLogging: {
        ignore: (req) => req.url === "/healthz"
      }
    })
  );

  receiver.app.get("/healthz", (_req, res) => {
    res.json({
      ok: true,
      name: "PioltPPT",
      version: "0.1.0"
    });
  });

  receiver.app.get("/slack/manifest", (_req, res) => {
    res.json(slackManifest());
  });

  receiver.app.use(
    "/decks",
    express.static(config.decksDir, {
      index: "index.html",
      immutable: false,
      maxAge: "5m"
    })
  );

  mountMcpRoutes(receiver.app, agent);
  await writeManifestFile(path.join(config.projectRoot, "slack.manifest.json"));

  await slackApp.start(config.PORT);
  logger.info(
    {
      port: config.PORT,
      publicBaseUrl: config.PUBLIC_BASE_URL,
      installUrl: `${config.PUBLIC_BASE_URL.replace(/\/$/, "")}/slack/install`,
      manifestUrl: `${config.PUBLIC_BASE_URL.replace(/\/$/, "")}/slack/manifest`
    },
    "PioltPPT server started"
  );
}

main().catch((error) => {
  if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
    logger.error(
      {
        port: config.PORT,
        hint: `Port ${config.PORT} is already in use. Stop the existing PioltPPT process or set PORT to a free port. On Windows: netstat -ano | findstr :${config.PORT}`
      },
      "PioltPPT could not start because the configured port is busy"
    );
    process.exit(1);
  }

  logger.error({ error }, "PioltPPT failed to start");
  process.exit(1);
});

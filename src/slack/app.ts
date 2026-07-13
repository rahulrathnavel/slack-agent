import path from "node:path";
import { App, ExpressReceiver, FileInstallationStore, LogLevel } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import { DeckAgent } from "../agent/deckAgent.js";
import { config } from "../config.js";
import { workspaceUrlFor } from "../editor/security.js";
import { logger } from "../logger.js";
import { importSlackDataFiles } from "../services/slackFiles.js";
import type { DeckRequest } from "../types.js";
import {
  ACTION_OPEN_REVISE,
  ACTION_OPEN_WIZARD,
  ACTION_QUICK_DRAFT,
  EMPTY_BUTTON_VALUE,
  VIEW_DECK_WIZARD,
  VIEW_REVISE_DECK,
  deckWizardModal,
  finishedBlocks,
  parseDeckRequestFromView,
  parseRevisionFromView,
  quickDraftRequest,
  reviseDeckModal,
  startBlocks,
  workingBlocks
} from "./blocks.js";

export function createSlackApp(agent = new DeckAgent()): { app: App; receiver: ExpressReceiver } {
  const installationStore = new FileInstallationStore({
    baseDir: config.installationDir,
    clientId: config.SLACK_CLIENT_ID
  });
  const tokenMode = Boolean(config.SLACK_BOT_TOKEN);
  const hasOAuth = !tokenMode && Boolean(config.SLACK_CLIENT_ID && config.SLACK_CLIENT_SECRET);

  const receiver = new ExpressReceiver({
    signingSecret: config.SLACK_SIGNING_SECRET,
    clientId: hasOAuth ? config.SLACK_CLIENT_ID : undefined,
    clientSecret: hasOAuth ? config.SLACK_CLIENT_SECRET : undefined,
    stateSecret: hasOAuth ? config.SLACK_STATE_SECRET : undefined,
    scopes: hasOAuth ? config.slackScopes : undefined,
    installerOptions: hasOAuth
      ? {
          directInstall: true,
          userScopes: config.slackUserScopes,
          installPath: "/slack/install",
          redirectUriPath: "/slack/oauth_redirect"
        }
      : undefined,
    installationStore,
    processBeforeResponse: false
  });

  const app = new App({
    receiver,
    token: config.SLACK_BOT_TOKEN || undefined,
    logLevel: config.NODE_ENV === "development" ? LogLevel.DEBUG : LogLevel.INFO
  });

  registerSlackHandlers(app, agent);
  return { app, receiver };
}

function registerSlackHandlers(app: App, agent: DeckAgent): void {
  app.command("/pioltppt", async ({ ack, body, client, context }) => {
    await ack();
    const topic = cleanSlackText(body.text ?? "");
    if (topic) {
      const request = quickDraftRequest(topic, body.user_id, body.channel_id);
      await generateAndPost({ request, client, agent, botToken: context.botToken });
      return;
    }

    await client.views.open({
      trigger_id: body.trigger_id,
      view: deckWizardModal({
        channelId: body.channel_id,
        prefillTopic: body.text,
        threadTs: undefined
      })
    });
  });

  app.action(ACTION_OPEN_WIZARD, async ({ ack, body, client }) => {
    await ack();
    const payload = body as any;
    await client.views.open({
      trigger_id: payload.trigger_id,
      view: deckWizardModal({
        channelId: payload.channel?.id,
        threadTs: payload.message?.thread_ts || payload.message?.ts,
        prefillTopic: slackButtonValue(payload.actions?.[0]?.value)
      })
    });
  });

  app.action(ACTION_QUICK_DRAFT, async ({ ack, body, client, context }) => {
    await ack();
    const payload = body as any;
    const topic = slackButtonValue(payload.actions?.[0]?.value) || payload.message?.text || "A practical presentation";
    const request = quickDraftRequest(
      cleanSlackText(topic),
      payload.user?.id,
      payload.channel?.id,
      payload.message?.thread_ts || payload.message?.ts
    );
    await generateAndPost({ request, client, agent, botToken: context.botToken });
  });

  app.action(ACTION_OPEN_REVISE, async ({ ack, body, client }) => {
    await ack();
    const payload = body as any;
    let value: { deckId?: string; publicUrl?: string } = {};
    try {
      value = JSON.parse(payload.actions?.[0]?.value ?? "{}");
    } catch {
      value = {};
    }
    await client.views.open({
      trigger_id: payload.trigger_id,
      view: reviseDeckModal({
        deckId: value.deckId ?? "",
        publicUrl: value.publicUrl,
        channelId: payload.channel?.id,
        threadTs: payload.message?.thread_ts || payload.message?.ts
      })
    });
  });

  app.view(VIEW_DECK_WIZARD, async ({ ack, body, view, client, context }) => {
    const values = view.state.values as Record<string, Record<string, any>>;
    const topic = values.topic?.topic?.value?.trim();
    if (!topic) {
      await ack({
        response_action: "errors",
        errors: {
          topic: "Add a topic or rough prompt so PioltPPT knows what to build."
        }
      });
      return;
    }

    await ack({ response_action: "clear" });
    const request = parseDeckRequestFromView(view, body.user.id);
    await generateAndPost({ request, client, agent, botToken: context.botToken });
  });

  app.view(VIEW_REVISE_DECK, async ({ ack, body, view, client }) => {
    const values = view.state.values as Record<string, Record<string, any>>;
    const deckId = values.deck_id?.deck_id?.value?.trim();
    const instruction = values.revision?.revision?.value?.trim();
    const errors: Record<string, string> = {};
    if (!deckId) {
      errors.deck_id = "Add the PioltPPT deck ID.";
    }
    if (!instruction) {
      errors.revision = "Tell PioltPPT what to change.";
    }
    if (Object.keys(errors).length) {
      await ack({ response_action: "errors", errors });
      return;
    }

    await ack();
    const revision = parseRevisionFromView(view);
    await reviseAndPost({
      ...revision,
      userId: body.user.id,
      client,
      agent
    });
  });

  app.event("app_mention", async ({ event, say, client, context }) => {
    const message = event as any;
    const text = cleanSlackText(message.text ?? "");
    const files = Array.isArray(message.files) ? message.files : [];
    if (files.length) {
      void handleSlackDataFiles({
        userId: message.user,
        channelId: message.channel,
        threadTs: message.thread_ts || message.ts,
        text,
        files,
        client,
        agent,
        botToken: context.botToken
      });
      return;
    }
    await say({
      thread_ts: message.thread_ts || message.ts,
      blocks: startBlocks(text, workspaceUrlFor(message.user))
    });
  });

  app.message(async ({ message, say, client, context }) => {
    const msg = message as any;
    if (msg.subtype || msg.bot_id || msg.channel_type !== "im") {
      return;
    }
    const text = cleanSlackText(msg.text ?? "");
    const files = Array.isArray(msg.files) ? msg.files : [];
    if (files.length) {
      void handleSlackDataFiles({
        userId: msg.user,
        channelId: msg.channel,
        threadTs: msg.thread_ts || msg.ts,
        text,
        files,
        client,
        agent,
        botToken: context.botToken
      });
      return;
    }
    const revision = parseRevisionCommand(text);
    if (revision) {
      await say(`Updating deck ${revision.deckId}. I will post the refreshed link here when it is ready.`);
      await reviseAndPost({
        ...revision,
        userId: msg.user,
        client,
        agent
      });
      return;
    }

    await say({
      blocks: startBlocks(text, workspaceUrlFor(msg.user))
    });
  });

  app.event("app_home_opened", async ({ event, client }) => {
    await client.views.publish({
      user_id: (event as any).user,
      view: {
        type: "home",
        blocks: [
          {
            type: "header",
            text: { type: "plain_text", text: "PioltPPT" }
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text:
                "Turn Slack context, messy notes, web research, and licensed assets into live presentation websites."
            }
          },
          ...startBlocks(undefined, workspaceUrlFor((event as any).user))
        ]
      }
    });
  });

  app.error(async (error) => {
    logger.error({ error }, "Slack app error");
  });
}

async function handleSlackDataFiles(params: {
  userId: string;
  channelId: string;
  threadTs?: string;
  text: string;
  files: any[];
  client: WebClient;
  agent: DeckAgent;
  botToken?: string;
}): Promise<void> {
  try {
    await params.client.chat.postMessage({
      channel: params.channelId,
      thread_ts: params.threadTs,
      text: "I found data files. I am importing them and will post the data deck here."
    });
    const dataFiles = await importSlackDataFiles({
      ownerId: params.userId,
      files: params.files,
      token: params.botToken
    });
    if (!dataFiles.length) {
      await params.client.chat.postMessage({
        channel: params.channelId,
        thread_ts: params.threadTs,
        text: "I could not import a supported CSV/XLSX file from that message. Try Data Studio or upload a CSV/XLSX directly."
      });
      return;
    }
    const request = {
      ...quickDraftRequest(params.text || `${dataFiles[0]?.name ?? "Uploaded"} data insights`, params.userId, params.channelId, params.threadTs),
      useSlackContext: true,
      useWebResearch: false,
      dataFiles
    };
    await generateAndPost({ request, client: params.client, agent: params.agent, botToken: params.botToken });
  } catch (error) {
    logger.error({ error }, "Slack data file import failed");
    await params.client.chat.postMessage({
      channel: params.channelId,
      thread_ts: params.threadTs,
      text: "I could not process the attached data file. Check that it is CSV/XLSX and that the bot can access it."
    });
  }
}

async function generateAndPost(params: {
  request: DeckRequest;
  client: WebClient;
  agent: DeckAgent;
  botToken?: string;
}): Promise<void> {
  const channel = await resolveChannel(params.client, params.request.channelId, params.request.requesterUserId);
  if (!channel) {
    logger.warn({ request: params.request }, "Cannot resolve Slack channel for response");
    return;
  }

  const working = await params.client.chat.postMessage({
    channel,
    thread_ts: params.request.threadTs,
    blocks: workingBlocks(params.request),
    text: `Creating ${params.request.title || params.request.topic}`
  });

  try {
    const deck = await params.agent.generate(params.request, {
      botToken: params.botToken || config.SLACK_BOT_TOKEN,
      userToken: config.SLACK_USER_TOKEN
    });

    await params.client.chat.postMessage({
      channel,
      thread_ts: params.request.threadTs || working.ts,
      blocks: finishedBlocks({
        title: deck.title,
        deckId: deck.deckId,
        publicUrl: deck.publicUrl,
        editorUrl: deck.editorUrl,
        sourceCount: deck.sources.length,
        assetCount: deck.assets.length,
        workspaceUrl: params.request.requesterUserId ? workspaceUrlFor(params.request.requesterUserId) : undefined
      }),
      text: `${deck.title} is ready: ${deck.publicUrl}`
    });
  } catch (error) {
    logger.error({ error }, "Deck generation failed");
    await params.client.chat.postMessage({
      channel,
      thread_ts: params.request.threadTs || working.ts,
      text:
        "I could not finish the deck generation. Check the server logs, then try again with fewer slides or less source context."
    });
  }
}

async function reviseAndPost(params: {
  deckId: string;
  instruction: string;
  userId?: string;
  channelId?: string;
  threadTs?: string;
  client: WebClient;
  agent: DeckAgent;
}): Promise<void> {
  const channel = await resolveChannel(params.client, params.channelId, params.userId);
  if (!channel) {
    logger.warn({ deckId: params.deckId }, "Cannot resolve Slack channel for revision response");
    return;
  }

  const working = await params.client.chat.postMessage({
    channel,
    thread_ts: params.threadTs,
    text: `Revising deck ${params.deckId}...`
  });

  try {
    const deck = await params.agent.revise(params.deckId, params.instruction);
    await params.client.chat.postMessage({
      channel,
      thread_ts: params.threadTs || working.ts,
      blocks: finishedBlocks({
        title: deck.title,
        deckId: deck.deckId,
        publicUrl: deck.publicUrl,
        editorUrl: deck.editorUrl,
        sourceCount: deck.sources.length,
        assetCount: deck.assets.length,
        workspaceUrl: params.userId ? workspaceUrlFor(params.userId) : undefined
      }),
      text: `${deck.title} was revised: ${deck.publicUrl}`
    });
  } catch (error) {
    logger.error({ error, deckId: params.deckId }, "Deck revision failed");
    await params.client.chat.postMessage({
      channel,
      thread_ts: params.threadTs || working.ts,
      text: `I could not revise deck ${params.deckId}. Check the deck ID and try again.`
    });
  }
}

async function resolveChannel(client: WebClient, channelId?: string, userId?: string): Promise<string | undefined> {
  if (channelId) {
    return channelId;
  }

  if (!userId) {
    return undefined;
  }

  const response = await client.conversations.open({ users: userId });
  return response.channel?.id;
}

function cleanSlackText(text: string): string {
  return text.replace(/<@[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function slackButtonValue(value?: string): string | undefined {
  if (!value || value === EMPTY_BUTTON_VALUE) {
    return undefined;
  }
  return value;
}

function parseRevisionCommand(text: string): { deckId: string; instruction: string } | undefined {
  const match = text.match(/^revise\s+(?:deck\s+)?(?:https?:\/\/\S+\/decks\/([^/\s]+)\/?|([0-9]+-[A-Za-z0-9_-]+))\s+(.+)$/i);
  if (!match) {
    return undefined;
  }
  const deckId = match[1] || match[2];
  const instruction = match[3]?.trim();
  if (!deckId || !instruction) {
    return undefined;
  }
  return { deckId, instruction };
}

export function slackManifest(publicBaseUrl = config.PUBLIC_BASE_URL): Record<string, unknown> {
  const base = publicBaseUrl.replace(/\/$/, "");
  return {
    display_information: {
      name: "PioltPPT",
      description: "Create live presentation websites from Slack context and web research.",
      background_color: "#111827"
    },
    features: {
      app_home: {
        home_tab_enabled: true,
        messages_tab_enabled: true,
        messages_tab_read_only_enabled: false
      },
      bot_user: {
        display_name: "PioltPPT",
        always_online: true
      },
      slash_commands: [
        {
          command: "/pioltppt",
          url: `${base}/slack/events`,
          description: "Create a live presentation website",
          usage_hint: "launch deck for enterprise customers",
          should_escape: false
        }
      ]
    },
    oauth_config: {
      redirect_urls: [`${base}/slack/oauth_redirect`],
      scopes: {
        bot: config.slackScopes,
        user: config.slackUserScopes
      }
    },
    settings: {
      event_subscriptions: {
        request_url: `${base}/slack/events`,
        bot_events: ["app_home_opened", "app_mention", "message.im"]
      },
      interactivity: {
        is_enabled: true,
        request_url: `${base}/slack/events`
      },
      org_deploy_enabled: true,
      socket_mode_enabled: false,
      token_rotation_enabled: false
    },
    mcp_servers: {
      pioltppt: {
        url: `${base}/mcp`,
        auth_type: "slack_identity_auth"
      }
    }
  };
}

export async function writeManifestFile(filePath: string, publicBaseUrl = config.PUBLIC_BASE_URL): Promise<void> {
  const fs = await import("node:fs/promises");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(slackManifest(publicBaseUrl), null, 2)}\n`, "utf8");
}

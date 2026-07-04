import { WebClient } from "@slack/web-api";
import { config } from "../config.js";
import { logger } from "../logger.js";
import type { ResearchSource, SlackContextSearchResult } from "../types.js";

interface SlackSearchMessage {
  author_name?: string;
  channel_name?: string;
  content?: string;
  permalink?: string;
}

interface SlackSearchFile {
  title?: string;
  content?: string;
  permalink?: string;
  author_name?: string;
}

interface SlackSearchResponse {
  ok?: boolean;
  error?: string;
  results?: {
    messages?: SlackSearchMessage[];
    files?: SlackSearchFile[];
  };
}

export async function searchSlackContext(params: {
  query: string;
  botToken?: string;
  userToken?: string;
  actionToken?: string;
  contextChannelId?: string;
}): Promise<SlackContextSearchResult> {
  const token = params.userToken || config.SLACK_USER_TOKEN || params.botToken || config.SLACK_BOT_TOKEN;
  if (!token) {
    return {
      sources: [],
      text: "",
      unavailableReason: "No Slack token is available yet. Install the app or provide SLACK_USER_TOKEN/SLACK_BOT_TOKEN."
    };
  }

  const client = new WebClient(token);
  const args: Record<string, unknown> = {
    query: params.query,
    channel_types: ["public_channel", "private_channel", "mpim", "im"],
    content_types: ["messages", "files"],
    include_context_messages: true,
    include_bots: false,
    limit: 8,
    sort: "timestamp",
    sort_dir: "desc"
  };

  if (params.contextChannelId) {
    args.context_channel_id = params.contextChannelId;
  }

  if (!params.userToken && !config.SLACK_USER_TOKEN && params.actionToken) {
    args.action_token = params.actionToken;
  }

  try {
    const response = (await client.apiCall("assistant.search.context", args)) as SlackSearchResponse;
    if (!response.ok) {
      return {
        sources: [],
        text: "",
        unavailableReason: response.error ?? "Slack RTS API returned an unknown error."
      };
    }

    const sources: ResearchSource[] = [
      ...(response.results?.messages ?? []).map((message) => ({
        title: message.channel_name ? `Slack: #${message.channel_name}` : "Slack message",
        url: message.permalink ?? "slack://message",
        snippet: message.content,
        author: message.author_name,
        sourceType: "slack" as const
      })),
      ...(response.results?.files ?? []).map((file) => ({
        title: file.title ?? "Slack file",
        url: file.permalink ?? "slack://file",
        snippet: file.content,
        author: file.author_name,
        sourceType: "slack" as const
      }))
    ];

    return {
      sources,
      text: sources
        .map((source, index) => `[${index + 1}] ${source.title}\n${source.snippet ?? ""}\n${source.url}`)
        .join("\n\n")
    };
  } catch (error) {
    logger.warn({ error }, "Slack RTS search failed");
    return {
      sources: [],
      text: "",
      unavailableReason: error instanceof Error ? error.message : "Slack RTS API failed."
    };
  }
}

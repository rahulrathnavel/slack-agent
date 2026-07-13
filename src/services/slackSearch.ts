import { WebClient } from "@slack/web-api";
import { config } from "../config.js";
import { logger } from "../logger.js";
import type { ResearchSource, SlackContextSearchResult } from "../types.js";

interface SlackSearchMessage {
  author_name?: string;
  channel_name?: string;
  content?: string;
  permalink?: string;
  message_ts?: string;
  timestamp?: string;
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
  fromDate?: string;
  toDate?: string;
  person?: string;
  client?: WebClient;
  allowConfiguredUserToken?: boolean;
}): Promise<SlackContextSearchResult> {
  const configuredUserToken = params.allowConfiguredUserToken === false ? undefined : config.SLACK_USER_TOKEN;
  const token = params.userToken || configuredUserToken || params.botToken || config.SLACK_BOT_TOKEN;
  if (!token && !params.client) {
    return {
      sources: [],
      text: "",
      unavailableReason: "No Slack token is available yet. Install the app or provide SLACK_USER_TOKEN/SLACK_BOT_TOKEN."
    };
  }

  const client = params.client ?? new WebClient(token!);
  const person = await resolveSlackPerson(client, params.person);
  const query = buildSlackQuery(params.query, params.fromDate, params.toDate, person);
  const args: Record<string, unknown> = {
    query,
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

  if (!params.userToken && !configuredUserToken && params.actionToken) {
    args.action_token = params.actionToken;
  }

  try {
    let assistantError: string | undefined;
    let response: SlackSearchResponse = { ok: false, results: {} };
    try {
      response = (await client.apiCall("assistant.search.context", args)) as SlackSearchResponse;
      if (!response.ok) assistantError = response.error ?? "Slack assistant search returned an unknown error.";
    } catch (error) {
      assistantError = slackErrorMessage(error);
      logger.info({ error }, "Slack assistant context search unavailable; trying exact message search");
    }

    const sources: ResearchSource[] = [
      ...(response.ok ? response.results?.messages ?? [] : []).map((message) => ({
        title: message.channel_name ? `Slack: #${message.channel_name}` : "Slack message",
        url: message.permalink ?? "slack://message",
        snippet: message.content,
        author: message.author_name,
        sourceType: "slack" as const,
        publishedDate: formatSlackTimestamp(message.message_ts ?? message.timestamp)
      })),
      ...(response.ok ? response.results?.files ?? [] : []).map((file) => ({
        title: file.title ?? "Slack file",
        url: file.permalink ?? "slack://file",
        snippet: file.content,
        author: file.author_name,
        sourceType: "slack" as const
      }))
    ];

    const exactEvidence = await searchSlackMessages(client, query);
    const mergedSources = dedupeSlackSources([...exactEvidence, ...sources]);

    return {
      sources: mergedSources,
      text: mergedSources
        .map((source, index) => `[${index + 1}] ${source.title}${source.author ? ` · ${source.author}` : ""}${source.publishedDate ? ` · ${source.publishedDate}` : ""}\n${source.snippet ?? ""}\n${source.url}`)
        .join("\n\n"),
      unavailableReason: !mergedSources.length && assistantError ? friendlySlackSearchError(assistantError) : undefined
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

async function searchSlackMessages(client: WebClient, query: string): Promise<ResearchSource[]> {
  try {
    const response = (await client.search.messages({ query, count: 40, sort: "timestamp", sort_dir: "asc" })) as unknown as {
      messages?: { matches?: Array<{ username?: string; channel_name?: string; text?: string; permalink?: string; ts?: string }> };
    };
    return (response.messages?.matches ?? []).map((message) => ({
      title: message.channel_name ? `Slack: #${message.channel_name}` : "Slack message",
      url: message.permalink ?? "slack://message",
      snippet: message.text,
      author: message.username,
      publishedDate: formatSlackTimestamp(message.ts),
      sourceType: "slack" as const
    }));
  } catch (error) {
    logger.info({ error }, "Exact Slack evidence search unavailable; using assistant context results");
    return [];
  }
}

export function buildSlackQuery(query: string, fromDate?: string, toDate?: string, person?: string): string {
  const terms = [query.trim()];
  if (fromDate && /^\d{4}-\d{2}-\d{2}$/.test(fromDate)) terms.push(`after:${fromDate}`);
  const exclusiveEnd = toDate && /^\d{4}-\d{2}-\d{2}$/.test(toDate) ? nextIsoDate(toDate) : undefined;
  if (exclusiveEnd) terms.push(`before:${exclusiveEnd}`);
  if (person?.trim()) terms.push(`from:${person.trim()}`);
  return terms.filter(Boolean).join(" ");
}

async function resolveSlackPerson(client: WebClient, person?: string): Promise<string | undefined> {
  const requested = person?.trim().replace(/^@/, "");
  if (!requested) return undefined;
  if (/^U[A-Z0-9]+$/i.test(requested)) return `<@${requested.toUpperCase()}>`;
  try {
    const response = await client.users.list({ limit: 200 });
    const normalized = requested.toLowerCase();
    const member = response.members?.find((candidate) =>
      [candidate.name, candidate.real_name, candidate.profile?.display_name, candidate.profile?.real_name]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase() === normalized)
    );
    if (member?.id) return `<@${member.id}>`;
  } catch (error) {
    logger.info({ error }, "Slack person lookup unavailable; using the supplied search handle");
  }
  return requested.replace(/\s+/g, "");
}

function nextIsoDate(value: string): string | undefined {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return undefined;
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function slackErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "data" in error) {
    const data = (error as { data?: { error?: unknown } }).data;
    if (typeof data?.error === "string") return data.error;
  }
  return error instanceof Error ? error.message : "Slack search failed.";
}

function friendlySlackSearchError(error: string): string {
  if (/missing_scope|not_allowed_token_type|invalid_auth|account_inactive/i.test(error)) {
    return "Slack search requires an authorized user token with the configured search scopes. Reinstall the app with user scopes or ask an administrator to enable them.";
  }
  return `Slack search is unavailable: ${error}`;
}

function formatSlackTimestamp(value?: string): string | undefined {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return new Date(seconds * 1_000).toISOString();
}

function dedupeSlackSources(sources: ResearchSource[]): ResearchSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.url}|${source.snippet ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

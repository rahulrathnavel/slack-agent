import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:3000"),
  SLACK_APP_ID: z.string().optional(),
  SLACK_CLIENT_ID: z.string().optional(),
  SLACK_CLIENT_SECRET: z.string().optional(),
  SLACK_SIGNING_SECRET: z.string().min(1),
  SLACK_VERIFICATION_TOKEN: z.string().optional(),
  SLACK_STATE_SECRET: z.string().min(16),
  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_USER_TOKEN: z.string().optional(),
  NVIDIA_API_BASE_URL: z.string().url().default("https://integrate.api.nvidia.com/v1"),
  NVIDIA_API_KEY: z.string().min(1),
  NVIDIA_MODEL_PRIMARY: z.string().default("mistralai/mistral-medium-3.5-128b"),
  NVIDIA_MODEL_REASONING: z.string().default("moonshotai/kimi-k2.6"),
  NVIDIA_MODEL_FAST: z.string().default("mistralai/mistral-medium-3.5-128b"),
  NVIDIA_MODEL_SAFETY: z.string().optional(),
  TAVILY_API_KEY: z.string().optional(),
  OPENVERSE_BASE_URL: z.string().url().default("https://api.openverse.engineering/v1"),
  DATA_DIR: z.string().default("./data"),
  PUBLIC_DIR: z.string().default("./public"),
  MCP_REQUIRE_SLACK_SIGNATURE: z.coerce.boolean().default(false)
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

export const config = {
  ...parsed.data,
  projectRoot,
  dataDir: path.resolve(projectRoot, parsed.data.DATA_DIR),
  publicDir: path.resolve(projectRoot, parsed.data.PUBLIC_DIR),
  decksDir: path.resolve(projectRoot, parsed.data.PUBLIC_DIR, "decks"),
  installationDir: path.resolve(projectRoot, parsed.data.DATA_DIR, "installations"),
  slackScopes: [
    "app_mentions:read",
    "assistant:write",
    "channels:history",
    "channels:read",
    "chat:write",
    "commands",
    "files:read",
    "im:history",
    "im:read",
    "im:write",
    "mcp:connect",
    "mpim:history",
    "reactions:write",
    "search:read.files",
    "search:read.public",
    "search:read.users",
    "users:read",
    "users:read.email"
  ],
  slackUserScopes: [
    "search:read.files",
    "search:read.im",
    "search:read.mpim",
    "search:read.private",
    "search:read.public",
    "search:read.users"
  ]
};

export type AppConfig = typeof config;

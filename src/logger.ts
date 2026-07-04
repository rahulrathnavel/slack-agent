import pino from "pino";

export const logger = pino({
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "SLACK_CLIENT_SECRET",
      "SLACK_SIGNING_SECRET",
      "SLACK_BOT_TOKEN",
      "SLACK_USER_TOKEN",
      "NVIDIA_API_KEY",
      "TAVILY_API_KEY"
    ],
    censor: "[redacted]"
  }
});

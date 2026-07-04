# PioltPPT Deployment Guide

This guide is for running PioltPPT as a real Slack app with public links and MCP access.

## 1. Prepare Secrets

Create production secrets in your hosting platform:

```bash
NODE_ENV=production
PORT=3000
PUBLIC_BASE_URL=https://your-domain.example
SLACK_APP_ID=
SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=
SLACK_SIGNING_SECRET=
SLACK_VERIFICATION_TOKEN=
SLACK_STATE_SECRET=
NVIDIA_API_BASE_URL=https://integrate.api.nvidia.com/v1
NVIDIA_API_KEY=
NVIDIA_MODEL_PRIMARY=mistralai/mistral-medium-3.5-128b
NVIDIA_MODEL_REASONING=moonshotai/kimi-k2.6
NVIDIA_MODEL_FAST=mistralai/mistral-medium-3.5-128b
TAVILY_API_KEY=
OPENVERSE_BASE_URL=https://api.openverse.engineering/v1
DATA_DIR=./data
PUBLIC_DIR=./public
```

Rotate any secret that has been pasted into chat or exposed in logs before production submission.

## 2. Deploy Backend

Use any Node-capable platform:

```bash
npm ci
npm run build
npm start
```

Required public routes:

- `/healthz`
- `/slack/events`
- `/slack/install`
- `/slack/oauth_redirect`
- `/slack/manifest`
- `/mcp`
- `/decks/*`

## 3. Configure Slack

Set these URLs in Slack:

```text
Event subscriptions: https://your-domain.example/slack/events
Interactivity:       https://your-domain.example/slack/events
Slash command:       https://your-domain.example/slack/events
OAuth redirect:      https://your-domain.example/slack/oauth_redirect
MCP server:          https://your-domain.example/mcp
```

Install URL:

```text
https://your-domain.example/slack/install
```

## 4. Validate

Run:

```bash
curl https://your-domain.example/healthz
curl https://your-domain.example/slack/manifest
```

In Slack:

```text
/pioltppt Launch plan for customer onboarding
```

Then test revision:

```text
revise <deckId> make slide 2 more executive and add ROI framing
```

## 5. Enable MCP In Slack

In Slack App Settings, enable the MCP server connection:

1. Open the app in `api.slack.com/apps`.
2. Go to `MCP Servers` or the `Agents` section.
3. Confirm the MCP server URL is:

```text
https://your-domain.example/mcp
```

4. Use `Slack identity auth`.
5. Save, then check the MCP logs from the same settings area while testing from Slackbot.

## 6. Hardening Checklist

- Move deck storage from local disk to S3/R2.
- Store Slack installations in Postgres instead of filesystem.
- Add a job queue for deck generation.
- Add per-workspace rate limits.
- Add workspace-authenticated private deck links if public links are not acceptable.
- Add audit logs for generated and revised decks.
- Add binary document ingestion for PDF, DOCX, CSV, XLSX, and PPTX.

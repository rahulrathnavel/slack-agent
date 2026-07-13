import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

export function editorTokenFor(deckId: string): string {
  return createHmac("sha256", config.SLACK_STATE_SECRET).update(`deck-editor:${deckId}`).digest("hex");
}

export function editorUrlFor(deckId: string): string {
  const base = config.PUBLIC_BASE_URL.replace(/\/$/, "");
  return `${base}/editor/${encodeURIComponent(deckId)}#token=${editorTokenFor(deckId)}`;
}

export function isValidEditorToken(deckId: string, token: string): boolean {
  const expected = Buffer.from(editorTokenFor(deckId));
  const received = Buffer.from(token);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function workspaceTokenFor(userId: string): string {
  return createHmac("sha256", config.SLACK_STATE_SECRET).update(`workspace:${userId}`).digest("hex");
}

export function workspaceUrlFor(userId: string): string {
  const base = config.PUBLIC_BASE_URL.replace(/\/$/, "");
  return `${base}/workspace/${encodeURIComponent(userId)}?token=${workspaceTokenFor(userId)}`;
}

export function isValidWorkspaceToken(userId: string, token: string): boolean {
  const expected = Buffer.from(workspaceTokenFor(userId));
  const received = Buffer.from(token);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

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

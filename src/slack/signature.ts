import crypto from "node:crypto";

export function verifySlackSignature(params: {
  signingSecret: string;
  rawBody: string;
  timestamp?: string | string[];
  signature?: string | string[];
}): boolean {
  const timestamp = Array.isArray(params.timestamp) ? params.timestamp[0] : params.timestamp;
  const signature = Array.isArray(params.signature) ? params.signature[0] : params.signature;
  if (!timestamp || !signature) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > 60 * 5) {
    return false;
  }

  const basestring = `v0:${timestamp}:${params.rawBody}`;
  const digest = `v0=${crypto.createHmac("sha256", params.signingSecret).update(basestring).digest("hex")}`;
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
}

import { config } from "../config.js";
import { logger } from "../logger.js";
import { asDataFile, MAX_UPLOAD_BYTES, storeUpload, uploadKindFor } from "./uploads.js";
import type { DataFileInput } from "../types.js";

interface SlackFileLike {
  id?: string;
  name?: string;
  mimetype?: string;
  url_private_download?: string;
  permalink?: string;
}

export async function importSlackDataFiles(params: {
  ownerId: string;
  files: SlackFileLike[];
  token?: string;
}): Promise<DataFileInput[]> {
  const token = params.token || config.SLACK_BOT_TOKEN;
  if (!token) return [];
  const imported: DataFileInput[] = [];
  for (const file of params.files) {
    if (!file.name || !file.url_private_download || !uploadKindFor(file.name, file.mimetype)) continue;
    try {
      const downloadUrl = trustedSlackDownloadUrl(file.url_private_download);
      const response = await fetchSlackDownload(downloadUrl, token);
      if (!response.ok) {
        logger.warn({ status: response.status, fileId: file.id }, "Slack file download failed");
        continue;
      }

      const contentLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES) {
        logger.warn({ fileId: file.id, contentLength }, "Slack file exceeds the upload limit");
        continue;
      }
      const upload = await storeUpload({
        ownerId: params.ownerId,
        name: file.name,
        buffer: await readLimitedBody(response),
        mime: file.mimetype,
        source: "slack",
        sourceUrl: file.permalink
      });
      const dataFile = asDataFile(upload);
      if (dataFile) imported.push(dataFile);
    } catch (error) {
      logger.warn({ error, fileId: file.id }, "Slack data-file import failed");
    }
  }
  return imported;
}

function trustedSlackDownloadUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || !isSlackOwnedHost(url.hostname)) {
    throw new Error("Slack file downloads must use an official Slack HTTPS URL.");
  }
  return url;
}

async function fetchSlackDownload(initialUrl: URL, token: string): Promise<Response> {
  let current = initialUrl;
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    if (current.protocol !== "https:" || (!isSlackOwnedHost(current.hostname) && !isApprovedSlackCdnHost(current.hostname))) {
      throw new Error("Slack file download redirected to an untrusted host.");
    }
    const response = await fetch(current, {
      headers: isSlackOwnedHost(current.hostname) ? { Authorization: `Bearer ${token}` } : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(30_000)
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) throw new Error("Slack file redirect did not include a destination.");
    current = new URL(location, current);
  }
  throw new Error("Slack file download exceeded the redirect limit.");
}

function isSlackOwnedHost(hostname: string): boolean {
  return hostname === "files.slack.com" || hostname.endsWith(".files.slack.com") || hostname.endsWith(".slack.com") || hostname.endsWith(".slack-edge.com");
}

function isApprovedSlackCdnHost(hostname: string): boolean {
  return hostname.endsWith(".amazonaws.com") || hostname.endsWith(".cloudfront.net") || hostname === "slack-files.com" || hostname.endsWith(".slack-files.com");
}

async function readLimitedBody(response: Response): Promise<Buffer> {
  if (!response.body) throw new Error("Slack returned an empty file response.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_UPLOAD_BYTES) {
      await reader.cancel("File exceeds the upload limit");
      throw new Error("Slack file exceeds the 20 MB upload limit.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

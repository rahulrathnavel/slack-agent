import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import sanitizeFilename from "sanitize-filename";
import JSZip from "jszip";
import { config } from "../config.js";
import type { DataFileInput, DataFileKind } from "../types.js";
import { readJsonFile, writeJsonFile } from "../storage/files.js";

export type UploadKind = DataFileKind | "pdf" | "pptx";

export interface StoredUpload {
  id: string;
  ownerId: string;
  name: string;
  path: string;
  kind: UploadKind;
  source: "slack" | "upload";
  sourceUrl?: string;
  uploadedAt: string;
}

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export function uploadKindFor(name: string, mime?: string): UploadKind | undefined {
  const lower = name.toLowerCase();
  if (lower.endsWith(".csv") || mime === "text/csv") return "csv";
  if (lower.endsWith(".xlsx") || mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return "xlsx";
  if (lower.endsWith(".pdf") || mime === "application/pdf") return "pdf";
  if (lower.endsWith(".pptx") || mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation") return "pptx";
  return undefined;
}

export async function storeUpload(params: {
  ownerId: string;
  name: string;
  buffer: Buffer;
  kind?: UploadKind;
  mime?: string;
  source: "slack" | "upload";
  sourceUrl?: string;
}): Promise<StoredUpload> {
  if (!params.buffer.length) throw new Error("The uploaded file is empty.");
  if (params.buffer.length > MAX_UPLOAD_BYTES) throw new Error("Files must be 20 MB or smaller.");
  const kind = params.kind ?? uploadKindFor(params.name, params.mime);
  if (!kind) throw new Error("Use CSV, XLSX, PDF, or PPTX files.");
  await validateUploadContent(params.buffer, kind);
  const id = nanoid(14);
  const safeName = sanitizeFilename(params.name).replace(/^\.+/, "") || `upload.${kind}`;
  const ownerDirectory = path.join(config.uploadsDir, sanitizeFilename(params.ownerId));
  const filePath = path.join(ownerDirectory, `${id}-${safeName}`);
  const upload: StoredUpload = {
    id,
    ownerId: params.ownerId,
    name: safeName,
    path: filePath,
    kind,
    source: params.source,
    sourceUrl: params.sourceUrl,
    uploadedAt: new Date().toISOString()
  };
  await fs.mkdir(ownerDirectory, { recursive: true });
  await fs.writeFile(filePath, params.buffer);
  await writeJsonFile(uploadMetadataPath(id), upload);
  return upload;
}

export async function getUpload(ownerId: string, id: string): Promise<StoredUpload | undefined> {
  const upload = await readJsonFile<StoredUpload>(uploadMetadataPath(id));
  if (!upload || upload.ownerId !== ownerId) return undefined;
  try {
    await fs.access(upload.path);
    return upload;
  } catch {
    return undefined;
  }
}

export function asDataFile(upload: StoredUpload): DataFileInput | undefined {
  if (upload.kind !== "csv" && upload.kind !== "xlsx") return undefined;
  return {
    id: upload.id,
    name: upload.name,
    path: upload.path,
    kind: upload.kind,
    source: upload.source,
    sourceUrl: upload.sourceUrl
  };
}

async function validateUploadContent(buffer: Buffer, kind: UploadKind): Promise<void> {
  const zipSignature = buffer.length >= 4 ? buffer.readUInt32LE(0) : 0;
  const startsWithZip = [0x04034b50, 0x06054b50, 0x08074b50].includes(zipSignature);
  if (kind === "xlsx" || kind === "pptx") {
    if (!startsWithZip) throw new Error(`The uploaded ${kind.toUpperCase()} file is not a valid Office Open XML archive.`);
    await validateOfficeArchive(buffer, kind);
  }
  if (kind === "pdf" && buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("The uploaded PDF file does not have a valid PDF signature.");
  }
  if (kind === "csv" && buffer.subarray(0, Math.min(buffer.length, 8_192)).includes(0)) {
    throw new Error("The uploaded CSV appears to be a binary file.");
  }
}

async function validateOfficeArchive(buffer: Buffer, kind: "xlsx" | "pptx"): Promise<void> {
  let archive: JSZip;
  try {
    archive = await JSZip.loadAsync(buffer, { checkCRC32: false, createFolders: false });
  } catch {
    throw new Error(`The uploaded ${kind.toUpperCase()} file has an invalid ZIP directory.`);
  }
  const entries = Object.values(archive.files);
  const requiredEntry = kind === "xlsx" ? "xl/workbook.xml" : "ppt/presentation.xml";
  if (!archive.file("[Content_Types].xml") || !archive.file(requiredEntry)) {
    throw new Error(`The uploaded ${kind.toUpperCase()} file is missing required Office document parts.`);
  }
  if (entries.length > 4_000) throw new Error("The Office file contains too many archive entries.");
  let totalUncompressed = 0;
  for (const entry of entries) {
    const metadata = entry as unknown as { _data?: { compressedSize?: number; uncompressedSize?: number } };
    const compressed = metadata._data?.compressedSize ?? 0;
    const uncompressed = metadata._data?.uncompressedSize ?? 0;
    totalUncompressed += uncompressed;
    if (uncompressed > 40 * 1024 * 1024 || (compressed > 0 && uncompressed / compressed > 250)) {
      throw new Error("The Office file contains an unsafe compressed entry.");
    }
  }
  if (totalUncompressed > 120 * 1024 * 1024) throw new Error("The expanded Office file is too large to process safely.");
}

function uploadMetadataPath(id: string): string {
  return path.join(config.uploadsDir, "metadata", `${id}.json`);
}

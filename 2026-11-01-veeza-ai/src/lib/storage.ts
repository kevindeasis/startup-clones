import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const ALLOWED_MIME = ["image/jpeg", "image/png", "application/pdf"] as const;

export function maxUploadBytes(): number {
  const mb = Number(process.env.MAX_UPLOAD_MB || 5);
  return (Number.isFinite(mb) && mb > 0 ? mb : 5) * 1024 * 1024;
}

export function uploadRoot(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.env.UPLOAD_DIR || "./data/uploads");
}

function mimeFromName(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith(".pdf")) return "application/pdf";
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  return "";
}

export class UploadError extends Error {
  status = 400;
}

export interface SavedUpload {
  filePath: string;
  mimeType: string;
  buffer: Buffer;
}

export async function saveUpload(applicationId: string, file: File): Promise<SavedUpload> {
  if (!file || typeof file.arrayBuffer !== "function" || file.size === 0) {
    throw new UploadError("A non-empty file is required.");
  }
  if (file.size > maxUploadBytes()) {
    throw new UploadError(`File too large (max ${Math.round(maxUploadBytes() / 1024 / 1024)} MB).`);
  }
  const mimeType = (ALLOWED_MIME as readonly string[]).includes(file.type) ? file.type : mimeFromName(file.name || "");
  if (!mimeType) throw new UploadError("Only JPEG, PNG or PDF files are accepted.");
  const buffer = Buffer.from(await file.arrayBuffer());
  const dir = path.join(/*turbopackIgnore: true*/ uploadRoot(), applicationId);
  fs.mkdirSync(dir, { recursive: true });
  const safe = (file.name || "upload").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-60);
  const filePath = path.join(dir, `${crypto.randomUUID().slice(0, 8)}-${safe}`);
  fs.writeFileSync(filePath, buffer);
  return { filePath, mimeType, buffer };
}

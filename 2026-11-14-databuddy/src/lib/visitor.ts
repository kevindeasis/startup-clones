import crypto from "node:crypto";

export const SESSION_GAP_MS = 30 * 60 * 1000;

const sha256 = (s: string): string => crypto.createHash("sha256").update(s).digest("hex");

/** Cookieless visitor id; the salt rotates every UTC day so ids cannot be linked across days. */
export function visitorId(siteId: string, ip: string, userAgent: string, now: Date, secret = process.env.SALT_SECRET || "change-me"): string {
  const dailySalt = sha256(`${secret}|${now.toISOString().slice(0, 10)}`);
  return sha256(`${dailySalt}|${siteId}|${ip}|${userAgent}`).slice(0, 16);
}

/** Reuse the visitor's latest session if it was active < 30 min ago, else start one named after the 30-min bucket. */
export function pickSession(visitor: string, last: { session_id: string; ts: string } | undefined, nowMs: number): string {
  if (last && nowMs - Date.parse(last.ts) < SESSION_GAP_MS) return last.session_id;
  return `${visitor}${Math.floor(nowMs / SESSION_GAP_MS)}`;
}

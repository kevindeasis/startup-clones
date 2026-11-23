import { randomBytes } from "node:crypto";

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(5).toString("hex")}`;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function normalizeWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Normalise for verbatim-quote checks: case, whitespace and markdown emphasis insensitive. */
export function normalizeForMatch(s: string): string {
  return s
    .replace(/[*_`]/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function quoteInText(quote: string, text: string): boolean {
  const q = normalizeForMatch(quote);
  return q.length > 0 && normalizeForMatch(text).includes(q);
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** Find all dates in text (ISO or "Month D, YYYY"); returns ISO strings in order of appearance. */
export function findDates(text: string): string[] {
  const out: { i: number; iso: string }[] = [];
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) out.push({ i: m.index ?? 0, iso: m[0] });
  const re = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/gi;
  for (const m of text.matchAll(re)) {
    const mo = MONTHS.indexOf(m[1].toLowerCase()) + 1;
    out.push({ i: m.index ?? 0, iso: `${m[3]}-${String(mo).padStart(2, "0")}-${m[2].padStart(2, "0")}` });
  }
  return out.sort((a, b) => a.i - b.i).map((d) => d.iso);
}

export function findTime(text: string): string | undefined {
  const m = text.match(/\b(\d{1,2}(?::\d{2})?\s?[AP]\.?M\.?)/i);
  return m ? m[1].toUpperCase().replace(/\./g, "") : undefined;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function formatMoney(n?: number): string {
  if (n === undefined || n === null) return "not stated";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 2).replace(/\.?0+$/, "")}M`;
  if (n >= 1000) return `$${Math.round(n / 1000)}K`;
  return `$${n}`;
}

export function parseMoney(text: string): { amount: number; text: string } | undefined {
  const m = text.match(/\$\s?([\d,]+(?:\.\d+)?)\s?(million|thousand|M|K)?\b/i);
  if (!m) return undefined;
  let n = parseFloat(m[1].replace(/,/g, ""));
  const unit = (m[2] ?? "").toLowerCase();
  if (unit === "million" || unit === "m") n *= 1_000_000;
  else if (unit === "thousand" || unit === "k") n *= 1000;
  return { amount: Math.round(n), text: m[0].trim() };
}

/** Split text into sentences (also splits at newlines so table rows stay whole). */
export function sentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-Z0-9"(])/))
    .map((s) => s.replace(/^[-*#>\s]+/, "").trim())
    .filter((s) => s.length > 0);
}

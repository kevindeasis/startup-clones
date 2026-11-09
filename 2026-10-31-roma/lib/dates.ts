import * as chrono from "chrono-node";

function pad(n: number) { return String(n).padStart(2, "0"); }
export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function todayISO(): string { return toISODate(new Date()); }
export function weekdayName(d = new Date()): string {
  return d.toLocaleDateString("en-US", { weekday: "long" });
}

/** Parse a natural-language or ISO date phrase. Returns date (YYYY-MM-DD) and time (HH:MM) if stated. */
export function parseDatePhrase(text: string, ref = new Date()): { date: string | null; time: string | null; matched: string | null } {
  const res = chrono.parse(text, ref, { forwardDate: true });
  if (!res.length) return { date: null, time: null, matched: null };
  const r = res[0];
  const date = toISODate(r.start.date());
  const time = r.start.isCertain("hour") ? `${pad(r.start.get("hour")!)}:${pad(r.start.get("minute") ?? 0)}` : null;
  return { date, time, matched: r.text };
}

/** Normalize an LLM-supplied date (ISO or natural language) to YYYY-MM-DD, or null. */
export function normalizeDate(v: string | null | undefined): string | null {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  return parseDatePhrase(v).date;
}
export function normalizeTime(v: string | null | undefined): string | null {
  if (!v) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(v);
  if (m) return `${pad(+m[1])}:${m[2]}`;
  return parseDatePhrase(v).time;
}

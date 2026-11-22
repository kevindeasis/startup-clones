const DAY = 86_400_000;

export function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function toDate(s: string): Date {
  return new Date(s.length <= 10 ? `${s}T00:00:00Z` : s);
}
export function addDays(s: string, n: number): string {
  return iso(new Date(toDate(s).getTime() + n * DAY));
}
/** whole days from a to b (b - a) */
export function daysBetween(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY);
}
export function today(): string {
  return iso(new Date());
}
export function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}
export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
export function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}
export function pct(n: number): string {
  return `${Math.round(n)}%`;
}
export function words(s: string, max: number): string {
  const w = s.split(/\s+/);
  return w.length <= max ? s : w.slice(0, max).join(" ") + "…";
}

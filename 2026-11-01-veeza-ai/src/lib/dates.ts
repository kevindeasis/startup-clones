export function parseISO(s: string | null | undefined): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const d = new Date(s.slice(0, 10) + "T00:00:00Z");
  return Number.isNaN(d.getTime()) ? null : d;
}

export function addMonths(d: Date, months: number): Date {
  const r = new Date(d.getTime());
  r.setUTCMonth(r.getUTCMonth() + months);
  return r;
}

export function addYears(d: Date, years: number): Date {
  return addMonths(d, years * 12);
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** Whole-ish months between two dates (fractional). */
export function monthsBetween(a: Date, b: Date): number {
  return daysBetween(a, b) / 30.4375;
}

export function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

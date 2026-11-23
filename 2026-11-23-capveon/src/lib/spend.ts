import type { Award } from "./types";

export interface SpendSummary {
  total: number;
  byFiscalYear: { fy: number; total: number }[];
  topVendors: { vendor: string; total: number; count: number }[];
  byCategory: { category: string; total: number }[];
}

/** Fiscal year = calendar year of the award date (simplification, documented in README). */
export function fiscalYear(date: string): number {
  return parseInt(date.slice(0, 4), 10);
}

export function summarizeSpend(awards: Award[]): SpendSummary {
  const fy = new Map<number, number>();
  const vendors = new Map<string, { total: number; count: number }>();
  const cats = new Map<string, number>();
  let total = 0;
  for (const a of awards) {
    total += a.amount;
    fy.set(fiscalYear(a.date), (fy.get(fiscalYear(a.date)) ?? 0) + a.amount);
    const v = vendors.get(a.vendor) ?? { total: 0, count: 0 };
    vendors.set(a.vendor, { total: v.total + a.amount, count: v.count + 1 });
    cats.set(a.category, (cats.get(a.category) ?? 0) + a.amount);
  }
  return {
    total,
    byFiscalYear: [...fy.entries()].map(([y, t]) => ({ fy: y, total: t })).sort((a, b) => a.fy - b.fy),
    topVendors: [...vendors.entries()]
      .map(([vendor, v]) => ({ vendor, ...v }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5),
    byCategory: [...cats.entries()].map(([category, t]) => ({ category, total: t })).sort((a, b) => b.total - a.total),
  };
}

/** Spend over the latest three fiscal years present in `all` awards. */
export function threeYearSpend(awards: Award[], latestFy: number): number {
  return awards.filter((a) => fiscalYear(a.date) >= latestFy - 2).reduce((s, a) => s + a.amount, 0);
}

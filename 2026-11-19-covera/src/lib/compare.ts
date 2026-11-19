import { LINES } from "./types";
import type { ComparisonDiff, Line, LineComparison, Quote, RiskProfile } from "./types";

/** Deterministic quote diff: cheapest and broadest-coverage picks are computed in code, never by the LLM. */
export function buildDiff(quotes: Quote[]): ComparisonDiff {
  const quoted = quotes.filter((q) => q.status === "quoted" && typeof q.premium === "number");
  const rows = quoted.map((q) => ({
    quoteId: q.id,
    carrierName: q.carrierName,
    line: q.line,
    premium: q.premium as number,
    deductible: q.deductible,
    limits: q.limits ?? {},
    coverages: q.coverages ?? [],
    exclusions: q.exclusions ?? [],
  }));
  const byLine: LineComparison[] = [];
  for (const line of LINES) {
    const lineRows = rows.filter((r) => r.line === line);
    if (!lineRows.length) continue;
    const cheapest = [...lineRows].sort((a, b) => a.premium - b.premium || a.quoteId.localeCompare(b.quoteId))[0];
    const broadest = [...lineRows].sort(
      (a, b) => b.coverages.length - a.coverages.length || a.premium - b.premium || a.quoteId.localeCompare(b.quoteId),
    )[0];
    const recommended = broadest.premium <= cheapest.premium * 1.15 ? broadest : cheapest;
    byLine.push({
      line,
      quoteIds: lineRows.map((r) => r.quoteId),
      cheapestQuoteId: cheapest.quoteId,
      broadestQuoteId: broadest.quoteId,
      recommendedQuoteId: recommended.quoteId,
    });
  }
  return { rows, byLine };
}

export function overallRecommendation(diff: ComparisonDiff, requested: Line[]): string | undefined {
  for (const line of requested) {
    const lc = diff.byLine.find((l) => l.line === line);
    if (lc?.recommendedQuoteId) return lc.recommendedQuoteId;
  }
  return diff.byLine[0]?.recommendedQuoteId;
}

export function compareOpportunity(profile: RiskProfile, quotes: Quote[]) {
  const diff = buildDiff(quotes);
  return { diff, recommendedQuoteId: overallRecommendation(diff, profile.requestedLines) };
}

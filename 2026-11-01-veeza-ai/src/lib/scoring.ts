import type { Band, RuleResult } from "./types";

export function bandFor(score: number): Band {
  if (score >= 80) return "Strong";
  if (score >= 55) return "Needs work";
  return "Weak";
}

/**
 * Deterministic readiness score. Start at 100; -25 per missing required doc;
 * -20 per failed document; -8 per warning; -30 if any passport validity rule fails.
 */
export function computeScore(results: RuleResult[]): { score: number; band: Band } {
  let score = 100;
  let passportFailed = false;
  for (const r of results) {
    if (r.code === "passport_validity" || r.code.startsWith("passport_validity")) {
      if (r.severity === "fail") passportFailed = true;
      continue;
    }
    if (r.severity === "missing") score -= 25;
    else if (r.severity === "fail") score -= 20;
    else if (r.severity === "warning") score -= 8;
  }
  if (passportFailed) score -= 30;
  score = Math.max(0, Math.min(100, score));
  return { score, band: bandFor(score) };
}

const ORDER: Record<string, number> = { fail: 0, missing: 1, warning: 2, ok: 3 };

export function topFixes(results: RuleResult[], n = 3): string[] {
  return results
    .filter((r) => r.severity !== "ok")
    .sort((a, b) => ORDER[a.severity] - ORDER[b.severity])
    .slice(0, n)
    .map((r) => r.message);
}

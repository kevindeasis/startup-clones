import type { Criterion, Rec } from './schemas';

export type CriterionScore = { criterion_id: string; score: number; evidence: string; confidence: 'low' | 'medium' | 'high' };

/** Σ(score × weight) / Σ(5 × weight) × 100 */
export function overallScore(criteria: Criterion[], scores: CriterionScore[]): number {
  let num = 0, den = 0;
  for (const c of criteria) {
    const s = scores.find((x) => x.criterion_id === c.id)?.score ?? 0;
    num += s * c.weight;
    den += 5 * c.weight;
  }
  return den ? Math.round((num / den) * 1000) / 10 : 0;
}

/** Any dealbreaker scoring 0 forces reject. */
export function finalRecommendation(criteria: Criterion[], scores: CriterionScore[], llmRec: Rec): Rec {
  for (const c of criteria) {
    if (c.type === 'dealbreaker' && (scores.find((x) => x.criterion_id === c.id)?.score ?? 0) === 0) return 'reject';
  }
  return llmRec;
}

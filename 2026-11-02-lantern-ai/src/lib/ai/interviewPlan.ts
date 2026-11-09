import { structured, MOCK_LLM } from '../llm';
import { PlanOut, type PlanQuestion } from '../schemas';
import type { ModelLike } from './reviewCandidate';
import { mockPlan } from './mock';

export type ReviewLike = {
  summary: string;
  open_questions: string[];
  criteria_scores: { criterion_id: string; score: number; evidence: string; confidence: string }[];
};

export async function interviewPlan(review: ReviewLike, model: ModelLike): Promise<PlanQuestion[]> {
  const rank = { low: 0, medium: 1, high: 2 } as Record<string, number>;
  const lowest = [...review.criteria_scores]
    .sort((a, b) => rank[a.confidence] - rank[b.confidence] || a.score - b.score)
    .slice(0, 3)
    .map((s) => s.criterion_id);
  let questions: PlanQuestion[];
  if (MOCK_LLM) questions = mockPlan(model.criteria, review.open_questions, lowest);
  else {
    const system = `You design structured interview plans. Turn the candidate's open questions and lowest-confidence criteria into 6-10 targeted interview questions. Each question must set probes_criterion_id to an id from the rubric and describe what a strong answer sounds like. Do not ask about protected characteristics.
Rubric: ${JSON.stringify(model.criteria)}`;
    const out = await structured(PlanOut, system, JSON.stringify({ review, lowest_confidence_criteria: lowest }));
    questions = out.questions;
  }
  const ids = new Set(model.criteria.map((c) => c.id));
  return questions.map((q) => (ids.has(q.probes_criterion_id) ? q : { ...q, probes_criterion_id: model.criteria[0].id }));
}

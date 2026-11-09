import { structured, MOCK_LLM } from '../llm';
import { ReviewOut, type Criterion, type ReviewOutput } from '../schemas';
import { mockReview } from './mock';

export type ModelLike = { criteria: Criterion[]; taste_notes: string[] };

export async function reviewCandidate(resumeText: string, model: ModelLike): Promise<ReviewOutput> {
  if (MOCK_LLM) return mockReview(resumeText, model.criteria, model.taste_notes);
  const system = `You review job applications against a team's hiring model.
Rubric (JSON, use criterion ids verbatim):
${JSON.stringify(model.criteria, null, 2)}

Taste notes from the team:
${model.taste_notes.map((n) => `- ${n}`).join('\n') || '(none)'}

Rules:
- Cite evidence from the resume only (short quote or paraphrase). If none, write "none found".
- Never infer protected characteristics (age, gender, ethnicity, religion, disability, family status); ignore them if present.
- When evidence is missing, score low AND add an open question rather than assuming the worst. Open questions are gaps to ask about, not proof of a gap.
- Return one entry per criterion with score 0-5, evidence, and confidence (low|medium|high), plus open_questions, a short summary, and a recommendation (advance|hold|reject). Humans make the final decision.`;
  return structured(ReviewOut, system, `Resume:\n\n${resumeText.slice(0, 30000)}`);
}

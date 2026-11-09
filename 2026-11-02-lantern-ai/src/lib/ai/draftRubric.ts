import { structured, MOCK_LLM } from '../llm';
import { DraftRubricOut, type Criterion } from '../schemas';
import { mockDraft } from './mock';

const SYSTEM = `You are a senior recruiter turning a job description into a scoring rubric.
Produce 4-8 criteria. Each has a short name, a one-sentence description of what good evidence looks like, a weight from 1 (minor) to 5 (critical), and a type: must_have, nice_to_have, or dealbreaker (use dealbreaker sparingly, only for hard requirements). Label at least one criterion must_have. Criteria must be job-related and must never reference protected characteristics.`;

export async function draftRubric(jobDescription: string): Promise<Omit<Criterion, 'id'>[]> {
  if (MOCK_LLM) return mockDraft(jobDescription);
  const out = await structured(DraftRubricOut, SYSTEM, `Job description:\n\n${jobDescription}`);
  const c = out.criteria;
  if (!c.some((x) => x.type === 'must_have')) c[0] = { ...c[0], type: 'must_have' };
  return c;
}

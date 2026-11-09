import { handler, json, HttpError } from '@/lib/http';
import * as repo from '@/lib/repo';
import { interviewPlan } from '@/lib/ai/interviewPlan';

export const dynamic = 'force-dynamic';
export const POST = handler<{ cid: string }>(async (_r, { params }) => {
  const { cid } = await params;
  const c = repo.getCandidate(cid);
  if (!c) throw new HttpError(404, 'Candidate not found');
  const review = repo.currentReview(cid, c.role_id);
  const model = review ? repo.getModelById(review.hiring_model_id) : null;
  if (!review || !model) throw new HttpError(409, 'Candidate has no review yet');
  const questions = await interviewPlan(review, model);
  return json({ plan: repo.savePlan(cid, questions), questions }, 201);
});

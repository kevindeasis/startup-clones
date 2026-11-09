import { handler, json, parseBody, HttpError } from '@/lib/http';
import { DecisionIn } from '@/lib/schemas';
import * as repo from '@/lib/repo';

export const dynamic = 'force-dynamic';
export const POST = handler<{ cid: string }>(async (req, { params }) => {
  const { cid } = await params;
  if (!repo.getCandidate(cid)) throw new HttpError(404, 'Candidate not found');
  const b = await parseBody(req, DecisionIn);
  return json({ decision: repo.addDecision(cid, b.decision, b.reason) }, 201);
});

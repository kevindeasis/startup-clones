import { handler, json, HttpError } from '@/lib/http';
import * as repo from '@/lib/repo';
import { proposeModelUpdate, type DecisionWithReview } from '@/lib/ai/proposeModelUpdate';

export const dynamic = 'force-dynamic';

export const POST = handler<{ id: string }>(async (_r, { params }) => {
  const { id } = await params;
  const previous = repo.latestApproved(id);
  if (!previous) throw new HttpError(409, 'No approved hiring model yet');
  const ds: DecisionWithReview[] = [];
  for (const c of repo.listCandidates(id)) {
    const d = repo.latestDecision(c.id);
    if (!d) continue;
    const r = repo.currentReview(c.id, id);
    ds.push({
      candidate: c.name, decision: d.decision as 'advance' | 'reject', reason: d.reason as string,
      overall_score: r?.overall_score ?? null, scores: r?.criteria_scores.map((s) => ({ criterion_id: s.criterion_id, score: s.score })) ?? [],
    });
  }
  if (ds.length < 2) return json({ proposal: null, previous, message: 'Not enough decisions yet (need at least 2)', change_summary: 'Not enough decisions yet' });
  // supersede any pending proposal
  const pending = repo.pendingProposal(id);
  if (pending) repo.setModelStatus(pending.id, 'discarded');
  const out = await proposeModelUpdate(previous, ds);
  const proposal = repo.insertModel(id, repo.maxVersion(id) + 1, 'proposed', out.criteria, out.taste_notes, out.change_summary);
  return json({ proposal, previous });
});

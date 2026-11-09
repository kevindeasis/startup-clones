import { handler, json, parseBody, HttpError } from '@/lib/http';
import { SaveModelIn } from '@/lib/schemas';
import * as repo from '@/lib/repo';

export const dynamic = 'force-dynamic';
type P = { id: string };

export const GET = handler<P>(async (_r, { params }) => {
  const { id } = await params;
  return json({ models: repo.listModels(id), latest: repo.latestApproved(id), pending: repo.pendingProposal(id) });
});

export const POST = handler<P>(async (req, { params }) => {
  const { id } = await params;
  if (!repo.getRole(id)) throw new HttpError(404, 'Role not found');
  const body = await parseBody(req, SaveModelIn);
  if ('proposal_id' in body) {
    const p = repo.getModelById(body.proposal_id);
    if (!p || p.role_id !== id || p.status !== 'proposed') throw new HttpError(404, 'Proposal not found');
    repo.setModelStatus(p.id, body.action === 'approve' ? 'approved' : 'discarded');
    return json({ model: repo.getModelById(p.id), latest: repo.latestApproved(id) });
  }
  const ids = new Set<string>();
  for (const c of body.criteria) { if (ids.has(c.id)) throw new HttpError(400, 'Duplicate criterion id ' + c.id); ids.add(c.id); }
  const taste = body.taste_notes ?? repo.latestApproved(id)?.taste_notes ?? [];
  const draft = repo.pendingDraft(id);
  if (!repo.latestApproved(id) && draft) {
    repo.updateDraft(draft.id, body.criteria, taste);
    return json({ model: repo.getModelById(draft.id) });
  }
  const model = repo.insertModel(id, repo.maxVersion(id) + 1, 'approved', body.criteria, taste, 'Edited manually');
  return json({ model });
});

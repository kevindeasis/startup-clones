import { handler, json, HttpError } from '@/lib/http';
import * as repo from '@/lib/repo';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export const POST = handler<{ id: string }>(async (_r, { params }) => {
  const { id } = await params;
  const model = repo.latestApproved(id);
  if (!model) throw new HttpError(409, 'No approved hiring model yet');
  const reviews = [];
  for (const c of repo.listCandidates(id)) reviews.push(await repo.reviewAndStore(c.id));
  return json({ model_version: model.version, reviews });
});

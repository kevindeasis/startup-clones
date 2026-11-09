import { handler, json, HttpError } from '@/lib/http';
import * as repo from '@/lib/repo';

export const dynamic = 'force-dynamic';
export const GET = handler<{ id: string }>(async (_r, { params }) => {
  const { id } = await params;
  if (!repo.getRole(id)) throw new HttpError(404, 'Role not found');
  return json(repo.pipelineSummary(id));
});

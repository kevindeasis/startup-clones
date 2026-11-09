import { handler, json, parseBody, HttpError } from '@/lib/http';
import { AskIn } from '@/lib/schemas';
import * as repo from '@/lib/repo';
import { askPipeline } from '@/lib/ai/askPipeline';

export const dynamic = 'force-dynamic';
type P = { id: string };

export const GET = handler<P>(async (_r, { params }) => json({ messages: repo.listMessages((await params).id) }));

export const POST = handler<P>(async (req, { params }) => {
  const { id } = await params;
  if (!repo.getRole(id)) throw new HttpError(404, 'Role not found');
  const { question } = await parseBody(req, AskIn);
  const history = repo.listMessages(id).slice(-10).map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content as string }));
  repo.addMessage(id, 'user', question);
  return askPipeline(question, repo.pipelineSummary(id), history, (text) => repo.addMessage(id, 'assistant', text));
});

import { handler, json, parseBody, HttpError } from '@/lib/http';
import { ResumeJsonIn } from '@/lib/schemas';
import * as repo from '@/lib/repo';
import { extractText, getDocumentProxy } from 'unpdf';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
type P = { id: string };

export const GET = handler<P>(async (_r, { params }) => {
  const { id } = await params;
  return json({ candidates: repo.listCandidates(id).map((c) => ({ ...c, review: repo.currentReview(c.id, id), decision: repo.latestDecision(c.id) })) });
});

function guessName(text: string, fallback: string) {
  const m = text.match(/^\s*name\s*:\s*(.+)$/im);
  if (m) return m[1].trim();
  const first = text.split('\n').map((l) => l.trim()).find(Boolean);
  if (first && first.length < 50 && !first.includes('@')) return first.replace(/^#+\s*/, '');
  return fallback;
}

export const POST = handler<P>(async (req, { params }) => {
  const { id } = await params;
  if (!repo.getRole(id)) throw new HttpError(404, 'Role not found');
  if (!repo.latestApproved(id)) throw new HttpError(409, 'Save the hiring model before adding candidates');
  const items: { name: string; filename: string | null; text: string }[] = [];
  const ct = req.headers.get('content-type') || '';
  if (ct.includes('multipart/form-data')) {
    const form = await req.formData();
    for (const f of form.getAll('files')) {
      if (!(f instanceof File)) continue;
      const base = f.name.replace(/\.[^.]+$/, '');
      let text: string;
      if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') {
        const pdf = await getDocumentProxy(new Uint8Array(await f.arrayBuffer()));
        text = (await extractText(pdf, { mergePages: true })).text;
      } else text = await f.text();
      if (!text.trim()) throw new HttpError(400, `No text extracted from ${f.name}`);
      items.push({ name: guessName(text, base), filename: f.name, text });
    }
    const nm = form.get('name');
    if (typeof nm === 'string' && nm.trim() && items.length === 1) items[0].name = nm.trim();
    if (!items.length) throw new HttpError(400, 'No files provided (use field "files")');
  } else {
    const b = await parseBody(req, ResumeJsonIn);
    items.push({ name: b.name?.trim() || guessName(b.resume_text, 'Unnamed candidate'), filename: null, text: b.resume_text });
  }
  const out = [];
  for (const it of items) {
    const c = repo.createCandidate(id, it.name, it.filename, it.text);
    const review = await repo.reviewAndStore(c.id);
    out.push({ ...c, review });
  }
  return json({ candidates: out }, 201);
});

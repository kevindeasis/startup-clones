// Smoke test for a running dev server. Usage: BASE_URL=http://localhost:3000 node scripts/smoke.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' - ' + extra : ''}`); if (!ok) failed++; };
const post = async (url, body) => {
  const r = await fetch(BASE + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, body: j };
};
const get = async (url) => { const r = await fetch(BASE + url); return { status: r.status, body: await r.json() }; };
const pdfFrom = (text) => new Promise((res) => {
  const doc = new PDFDocument(); const bufs = [];
  doc.on('data', (b) => bufs.push(b)); doc.on('end', () => res(Buffer.concat(bufs)));
  doc.fontSize(11).text(text); doc.end();
});

// Next dev compiles each route on first hit and can transiently 500 (HTML) right after a compile.
// Warm every route with harmless invalid requests until it answers JSON.
async function warmUp(roleId, candId) {
  const routes = ['/api/roles', `/api/roles/${roleId}/model`, `/api/roles/${roleId}/model/propose`, `/api/roles/${roleId}/rereview`,
    `/api/roles/${roleId}/summary`, `/api/roles/${roleId}/ask`, `/api/roles/${roleId}/candidates`, `/api/candidates/${candId}/decision`, `/api/candidates/${candId}/interview-plan`];
  for (const r of routes) {
    for (let i = 0; i < 4; i++) {
      const res = await fetch(BASE + r, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
      if ((res.headers.get('content-type') || '').includes('json')) break;
      await new Promise((x) => setTimeout(x, 500));
    }
  }
}

async function main() {
  const home = await fetch(BASE + '/');
  const html = await home.text();
  check('GET / returns 200 with roles UI', home.status === 200 && html.includes('Roles'));
  check('Mock LLM banner visible', html.includes('Mock LLM mode'));

  // 3. role + rubric
  const jd = fs.readFileSync(path.join(root, 'samples/jd-senior-backend.md'), 'utf8');
  await warmUp('warm', 'warm');
  const created = await post('/api/roles', { title: 'Senior Backend Engineer', job_description: jd });
  const role = created.body.role; const draft = created.body.draft_criteria;
  check('POST /api/roles returns role + 4-8 criteria', created.status === 201 && role?.id && draft?.length >= 4 && draft.length <= 8, `${draft?.length} criteria`);
  const saved = await post(`/api/roles/${role.id}/model`, { criteria: draft });
  check('Save creates Hiring Model v1 (approved)', saved.body.model?.version === 1 && saved.body.model?.status === 'approved');
  const ids = new Set(draft.map((c) => c.id));

  // 4. candidates: 3 txt + 1 pdf
  const samples = ['alice-nguyen', 'bob-okafor', 'carla-mendes'];
  const cands = [];
  for (const s of samples) {
    const text = fs.readFileSync(path.join(root, `samples/resume-${s}.txt`), 'utf8');
    const fd = new FormData(); fd.append('files', new Blob([text], { type: 'text/plain' }), `resume-${s}.txt`);
    const r = await fetch(`${BASE}/api/roles/${role.id}/candidates`, { method: 'POST', body: fd });
    const j = await r.json(); cands.push(...(j.candidates || []));
  }
  const alice = fs.readFileSync(path.join(root, 'samples/resume-alice-nguyen.txt'), 'utf8').replace('Alice Nguyen', 'Alice Pdf');
  const fd = new FormData(); fd.append('files', new Blob([await pdfFrom(alice)], { type: 'application/pdf' }), 'alice-pdf.pdf');
  const pr = await fetch(`${BASE}/api/roles/${role.id}/candidates`, { method: 'POST', body: fd });
  const pj = await pr.json(); cands.push(...(pj.candidates || []));
  check('3 txt candidates + 1 PDF candidate created', cands.length === 4, cands.map((c) => c.name).join(', '));
  check('PDF text was extracted', /Kafka/.test(cands[3]?.resume_text || ''));
  const reviewsOk = cands.every((c) => c.review && c.review.criteria_scores.length === draft.length && c.review.open_questions.length >= 1 && c.review.overall_score >= 0 && c.review.overall_score <= 100 && ['advance', 'hold', 'reject'].includes(c.review.recommendation));
  check('Each review has per-criterion scores, >=1 open question, 0-100 score, recommendation', reviewsOk, cands.map((c) => `${c.name}:${c.review?.overall_score}/${c.review?.recommendation}`).join(' | '));

  // 5. decisions -> propose -> approve -> rereview
  const d1 = await post(`/api/candidates/${cands[0].id}/decision`, { decision: 'advance', reason: 'Shipped a product end to end and strong Kafka experience' });
  const d2 = await post(`/api/candidates/${cands[2].id}/decision`, { decision: 'reject', reason: 'No backend experience' });
  check('Two decisions recorded', d1.status === 201 && d2.status === 201);
  const r2 = (await post('/api/roles', { title: 'Tiny role', job_description: '- python\n- sql\n- go\n- aws' })).body;
  await post(`/api/roles/${r2.role.id}/model`, { criteria: r2.draft_criteria });
  const early = await post(`/api/roles/${r2.role.id}/model/propose`);
  check('Propose refuses with <2 decisions (unchanged, "Not enough decisions yet")', early.body.proposal === null && early.body.change_summary === 'Not enough decisions yet');
  const prop = await post(`/api/roles/${role.id}/model/propose`);
  check('Propose creates proposed v2 with change_summary', prop.body.proposal?.status === 'proposed' && prop.body.proposal.version === 2 && prop.body.proposal.change_summary.length > 0, prop.body.proposal?.change_summary?.slice(0, 80));
  const appr = await post(`/api/roles/${role.id}/model`, { proposal_id: prop.body.proposal.id, action: 'approve' });
  check('Approve makes v2 the latest approved model', appr.body.latest?.version === 2);
  const rr = await post(`/api/roles/${role.id}/rereview`);
  const v2 = appr.body.latest.id;
  check('Re-review produces new reviews referencing v2', rr.body.reviews?.length === 4 && rr.body.reviews.every((r) => r.hiring_model_id === v2));

  // 6. interview plan
  const plan = await post(`/api/candidates/${cands[1].id}/interview-plan`);
  const qs = plan.body.questions || [];
  check('Interview plan has 6-10 questions referencing known criteria', qs.length >= 6 && qs.length <= 10 && qs.every((q) => ids.has(q.probes_criterion_id) && q.strong_answer_looks_like), `${qs.length} questions`);

  // 7. ask (streamed)
  const ar = await fetch(`${BASE}/api/roles/${role.id}/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'Who are my top 3 and why?' }) });
  const answer = await ar.text();
  check('Ask streams a non-empty answer', ar.status === 200 && answer.length > 20, JSON.stringify(answer.slice(0, 60)));
  await new Promise((r) => setTimeout(r, 300));
  const msgs = (await get(`/api/roles/${role.id}/ask`)).body.messages;
  check('Both messages persisted', msgs.length === 2 && msgs[0].role === 'user' && msgs[1].role === 'assistant' && msgs[1].content.length > 20);
  const sum = await get(`/api/roles/${role.id}/summary`);
  check('GET summary returns pipeline JSON', sum.body.counts?.total === 4 && sum.body.per_criterion?.length > 0);

  // pages render
  for (const p of [`/roles/${role.id}`, `/roles/${role.id}/model`, `/roles/${role.id}/candidates/${cands[0].id}`]) {
    const r = await fetch(BASE + p); check(`GET ${p.replace(/[0-9a-f-]{36}/g, ':id')} renders`, r.status === 200);
  }
  const bad = await post('/api/roles', { title: '' });
  check('Invalid input rejected with 400', bad.status === 400);

  console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll smoke checks passed');
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

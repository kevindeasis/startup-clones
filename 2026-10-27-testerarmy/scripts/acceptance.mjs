#!/usr/bin/env node
// Automates SPEC section 10 checks 2-5 against a running server.
// Usage: npm run acceptance   (env: BASE_URL, DATA_DIR)
import { existsSync } from 'node:fs';
import path from 'node:path';

const base = process.env.BASE_URL || 'http://localhost:3000';
const dataDir = path.resolve(process.env.DATA_DIR || './data');
let failed = 0;

function check(ok, desc, extra) {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${desc}${!ok && extra ? ` (${extra})` : ''}`);
}
async function safe(desc, fn) {
  try {
    await fn();
  } catch (e) {
    check(false, desc, e.message);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runTest(id) {
  const res = await fetch(`${base}/api/tests/${id}/run`, { method: 'POST' });
  if (!res.ok) throw new Error(`start failed: ${res.status}`);
  const { runId } = await res.json();
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    const run = await (await fetch(`${base}/api/runs/${runId}`)).json();
    // status flips before the video is finalized; wait for finishedAt too
    if (run.status !== 'queued' && run.status !== 'running' && run.finishedAt) return run;
    await sleep(1000);
  }
  throw new Error('timed out after 5 minutes');
}

await safe('GET / is 200 and lists seeded tests', async () => {
  const res = await fetch(`${base}/`);
  const html = await res.text();
  check(res.status === 200, 'GET / returns 200', `status ${res.status}`);
  const tests = await (await fetch(`${base}/api/tests`)).json();
  const names = ['seed1', 'seed2', 'seed3'].map((id) => tests.find((t) => t.id === id)?.name);
  check(names.every(Boolean), 'seeded tests seed1..seed3 exist via API');
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
  const missing = names.filter((n) => n && !html.includes(n) && !html.includes(esc(n)));
  check(missing.length === 0, 'GET / contains the three seeded test names', `missing: ${missing.join(', ')}`);
});

await safe('GET /demo', async () => {
  const res = await fetch(`${base}/demo`);
  check(res.status === 200, 'GET /demo returns 200', `status ${res.status}`);
});

const runs = {};
for (const id of ['seed1', 'seed2', 'seed3']) {
  await safe(`run ${id}`, async () => {
    runs[id] = await runTest(id);
    console.log(`INFO ${id} finished: ${runs[id].status}`);
  });
}

check(runs.seed1?.status === 'passed', 'seed1 ends passed', runs.seed1?.status);
check(runs.seed2?.status === 'passed', 'seed2 ends passed', runs.seed2?.status);
check(runs.seed3?.status === 'failed', 'seed3 ends failed', runs.seed3?.status);
check(
  /0 items left/.test(runs.seed3?.verdictReason || ''),
  'seed3 verdictReason contains "0 items left"',
  runs.seed3?.verdictReason,
);

const r1 = runs.seed1;
if (r1) {
  const steps = r1.steps || [];
  check(steps.length >= 6, 'seed1 has >= 6 steps', `${steps.length} steps`);
  check(steps.every((s) => s.actions?.length >= 1), 'seed1 every step has >= 1 action');
  const shots = steps.flatMap((s) => s.actions || []).map((a) => a.screenshotPath);
  check(shots.length > 0 && shots.every(Boolean), 'seed1 every action has a screenshotPath');
  const missing = shots.filter((p) => !p || !existsSync(path.join(dataDir, p)));
  check(missing.length === 0, 'seed1 every screenshot exists on disk', `missing: ${missing.join(', ')}`);
  check(!!r1.videoPath && existsSync(path.join(dataDir, r1.videoPath)), 'seed1 videoPath exists on disk', r1.videoPath);
  await safe('artifact fetch', async () => {
    const res = await fetch(`${base}/api/artifacts/${r1.videoPath}`);
    const ct = res.headers.get('content-type') || '';
    await res.arrayBuffer();
    check(res.status === 200 && ct.startsWith('video/webm'), 'GET /api/artifacts/<video> is 200 video/webm', `status ${res.status}, type ${ct}`);
  });
} else {
  check(false, 'seed1 run details available');
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);

#!/usr/bin/env node
// Usage: node scripts/run-test.mjs <testId> [--wait]   (BASE_URL env, default http://localhost:3000)
const base = process.env.BASE_URL || 'http://localhost:3000';
const [testId, ...flags] = process.argv.slice(2);
if (!testId) {
  console.error('usage: run-test.mjs <testId> [--wait]');
  process.exit(2);
}
const wait = flags.includes('--wait');

const res = await fetch(`${base}/api/tests/${testId}/run`, { method: 'POST' });
if (!res.ok) {
  console.error(`failed to start run: ${res.status} ${await res.text()}`);
  process.exit(2);
}
const { runId } = await res.json();
console.log(`runId=${runId}`);
if (!wait) process.exit(0);

const deadline = Date.now() + 6 * 60_000;
while (Date.now() < deadline) {
  const r = await (await fetch(`${base}/api/runs/${runId}`)).json();
  if (r.status !== 'queued' && r.status !== 'running') {
    console.log(`status=${r.status}${r.verdictReason ? ` reason=${r.verdictReason}` : ''}${r.error ? ` error=${r.error}` : ''}`);
    console.log(`${base}/runs/${runId}`);
    process.exit(r.status === 'passed' ? 0 : 1);
  }
  await new Promise((s) => setTimeout(s, 2000));
}
console.error('timed out waiting for run');
process.exit(1);

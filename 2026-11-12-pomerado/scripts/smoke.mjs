// End-to-end smoke test (mock mode, no API key). Usage: npm run smoke
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = mkdtempSync(join(tmpdir(), 'minter-smoke-'));
const DEMO = 'http://localhost:4310';
const env = {
  ...process.env,
  MINTER_MOCK: '1',
  MINTER_DATA_DIR: DATA,
  MINTER_SECRET_LIST_ORDERS_USERNAME: 'demo',
  MINTER_SECRET_LIST_ORDERS_PASSWORD: 'demo-pass',
  DEMO_SITE_PORT: '4310',
};
delete env.ANTHROPIC_API_KEY;
let failed = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && extra ? '  -> ' + extra : ''}`);
  if (!ok) failed++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const children = [];
const cli = (...args) => spawnSync('npx', ['tsx', 'src/cli.ts', ...args], { cwd: ROOT, env, encoding: 'utf8' });
const json = (r) => { try { return JSON.parse(r.stdout); } catch { return null; } };

async function startDemo(version) {
  const p = spawn('npx', ['tsx', 'src/cli.ts', 'demo-site'], { cwd: ROOT, env: { ...env, DEMO_SITE_VERSION: String(version) }, stdio: 'ignore', detached: true });
  children.push(p);
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(DEMO + '/')).ok) return p; } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('demo site did not start (is port 4310 busy?)');
}
const stop = async (p) => { try { process.kill(-p.pid); } catch { /* gone */ } await sleep(500); };
const sample = (n) => JSON.parse(readFileSync(join(ROOT, 'integrations', n, 'integration.json'), 'utf8'));

try {
  let demo = await startDemo(1);
  const cat = await (await fetch(`${DEMO}/catalog?q=bolt`)).text();
  check('demo site: /catalog?q=bolt has a table with bolt rows', /<table/.test(cat) && /bolt/i.test(cat));

  const m1 = cli('mint', '--name', 'search_parts', '--url', `${DEMO}/catalog`, '--task', 'Search the parts catalog and return the matching parts with name, price and stock', '--input', '{"query":"bolt"}');
  const sp = existsSync(join(ROOT, 'integrations/search_parts/integration.json')) ? sample('search_parts') : null;
  check('mint search_parts (mock)', m1.status === 0 && !!sp, m1.stderr.slice(-300));
  check('search_parts file shape (fill {{input.query}}, submit, table extract, selector+hints)',
    !!sp && !!sp.inputSchema.properties.query &&
    sp.steps.some((s) => s.type === 'fill' && s.value === '{{input.query}}') &&
    sp.steps.some((s) => s.type === 'click' || s.type === 'press') &&
    sp.steps.some((s) => s.type === 'extract' && s.mode === 'table') &&
    sp.steps.filter((s) => s.target).every((s) => s.target.selector && s.target.hints));
  const rows0 = (m1.stdout.match(/"part"/g) ?? []).length;
  check('mint verify run returned rows with part/price/stock', rows0 >= 1 && /"price"/.test(m1.stdout) && /"stock"/.test(m1.stdout));

  const r1 = json(cli('run', 'search_parts', '{"query":"washer"}'));
  check('run search_parts washer: all parts contain washer', r1?.ok && r1.results.length > 0 && r1.results.every((x) => /washer/i.test(x.part)));
  const r2 = json(cli('run', 'search_parts', '{"query":"zzzz"}'));
  check('run search_parts zzzz: ok with 0 results', r2?.ok === true && r2.results.length === 0);

  const m2 = cli('mint', '--name', 'list_orders', '--url', `${DEMO}/orders`, '--task', 'List my recent orders with order number, date, status and total', '--auth-url', `${DEMO}/login`, '--secret', 'USERNAME', '--secret', 'PASSWORD');
  const lo = existsSync(join(ROOT, 'integrations/list_orders/integration.json')) ? readFileSync(join(ROOT, 'integrations/list_orders/integration.json'), 'utf8') : '';
  check('mint list_orders with auth; file contains no password value', m2.status === 0 && lo.length > 0 && !lo.includes('demo-pass'), m2.stderr.slice(-300));
  const r3 = json(cli('run', 'list_orders'));
  check('run list_orders returns 6 orders', r3?.ok && r3.results.length === 6);
  const bad = spawnSync('npx', ['tsx', 'src/cli.ts', 'run', 'list_orders'], { cwd: ROOT, env: { ...env, MINTER_SECRET_LIST_ORDERS_PASSWORD: '' }, encoding: 'utf8' });
  const rb = json(bad);
  check('missing password env -> ok:false "missing secret"', rb?.ok === false && /missing secret/.test(rb.error));

  // MCP over stdio
  const client = new Client({ name: 'smoke', version: '0' });
  await client.connect(new StdioClientTransport({ command: 'npm', args: ['run', '-s', 'mcp'], cwd: ROOT, env: Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined)) }));
  const names = (await client.listTools()).tools.map((t) => t.name);
  check('MCP stdio tools/list has all 5 tools', ['search_parts', 'list_orders', 'build_website_tool', 'list_website_tools', 'run_website_tool'].every((n) => names.includes(n)), names.join(','));
  const call = await client.callTool({ name: 'search_parts', arguments: { query: 'bearing' } });
  check('MCP tools/call search_parts bearing -> structuredContent.results >= 1', call.structuredContent?.results?.length >= 1);
  const built = await client.callTool({ name: 'build_website_tool', arguments: { name: 'find_seals', url: `${DEMO}/catalog`, task: 'Find seals in the parts catalog', exampleInput: { query: 'seal' } } });
  const names2 = (await client.listTools()).tools.map((t) => t.name);
  check('build_website_tool find_seals creates file and appears in tools/list', !built.isError && names2.includes('find_seals') && existsSync(join(ROOT, 'integrations/find_seals/integration.json')), JSON.stringify(built.content).slice(0, 200));
  await client.close();
  rmSync(join(ROOT, 'integrations/find_seals'), { recursive: true, force: true });

  // HTTP server
  const serve = spawn('npx', ['tsx', 'src/cli.ts', 'serve', '--port', '4311'], { cwd: ROOT, env, stdio: 'ignore', detached: true });
  children.push(serve);
  for (let i = 0; i < 60; i++) { try { if ((await fetch('http://localhost:4311/')).ok) break; } catch { /* wait */ } await sleep(250); }
  const home = await (await fetch('http://localhost:4311/')).text();
  check('serve: GET / lists both integrations', home.includes('search_parts') && home.includes('list_orders'));
  const init = await fetch('http://localhost:4311/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } } }) });
  const initBody = await init.json();
  check('serve: POST /mcp initialize returns a result', !!initBody.result?.serverInfo);
  const api = await (await fetch('http://localhost:4311/api/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'search_parts', input: { query: 'nut' } }) })).json();
  check('serve: POST /api/run search_parts nut returns rows', api.ok && api.results.length >= 1);
  await stop(serve);

  // self-heal: switch demo site to version 2
  const v0 = sample('search_parts').version;
  await stop(demo);
  demo = await startDemo(2);
  const h = json(cli('run', 'search_parts', '{"query":"bolt"}'));
  const after = sample('search_parts');
  check('self-heal on demo v2: ok, healed === "selectors"', h?.ok === true && h.meta.healed === 'selectors', h?.error);
  check('self-heal: version bumped, history has heal:selectors, search box selector != #q',
    after.version > v0 && after.history.some((x) => x.reason === 'heal:selectors') && after.steps.find((s) => s.type === 'fill').target.selector !== '#q');
  const runs = readFileSync(join(DATA, 'runs.jsonl'), 'utf8');
  check('run log recorded healed:"selectors" and never input values', /"healed":"selectors"/.test(runs) && !runs.includes('washer') && !runs.includes('demo-pass'));

  // regenerate the committed sample integrations against the v1 site
  await stop(demo);
  demo = await startDemo(1);
  cli('mint', '--name', 'search_parts', '--url', `${DEMO}/catalog`, '--task', 'Search the parts catalog and return the matching parts with name, price and stock', '--input', '{"query":"bolt"}');
  cli('mint', '--name', 'list_orders', '--url', `${DEMO}/orders`, '--task', 'List my recent orders with order number, date, status and total', '--auth-url', `${DEMO}/login`, '--secret', 'USERNAME', '--secret', 'PASSWORD');
  console.log('(sample integrations regenerated against demo site v1)');
} catch (e) {
  check('smoke run completed without exception', false, String(e?.stack ?? e));
} finally {
  for (const c of children) { try { process.kill(-c.pid); } catch { /* already stopped */ } }
  rmSync(DATA, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll smoke checks PASSED');
process.exit(failed ? 1 : 0);

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { startDemoSite, type DemoHandle } from '../src/demo-site/server.js';
import { loadIntegration, saveIntegration } from '../src/integration.js';
import { buildMcpServer } from '../src/mcp/server.js';
import { mint } from '../src/mint/index.js';
import { runIntegration } from '../src/runner.js';
import { readRuns } from '../src/runlog.js';

let demo: DemoHandle;
let base: string;
const dir = mkdtempSync(join(tmpdir(), 'minter-int-'));
const data = mkdtempSync(join(tmpdir(), 'minter-data-'));
const silent = () => {};

beforeAll(async () => {
  process.env.MINTER_MOCK = '1';
  process.env.MINTER_INTEGRATIONS_DIR = dir;
  process.env.MINTER_DATA_DIR = data;
  process.env.MINTER_SECRET_LIST_ORDERS_USERNAME = 'demo';
  process.env.MINTER_SECRET_LIST_ORDERS_PASSWORD = 'demo-pass';
  demo = await startDemoSite(0, 1);
  base = `http://localhost:${demo.port}`;
});
afterAll(async () => {
  await demo.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(data, { recursive: true, force: true });
});

describe('end to end against the demo site', () => {
  it('mints, runs deterministically, handles empty results', async () => {
    const { integration } = await mint({ name: 'search_parts', url: `${base}/catalog`, task: 'Search the parts catalog', exampleInput: { query: 'bolt' }, log: silent });
    expect(integration.steps.find((s) => s.type === 'fill')).toMatchObject({ value: '{{input.query}}' });
    const r = await runIntegration('search_parts', { query: 'Washer' });
    expect(r.ok).toBe(true);
    const rows = r.results as Array<Record<string, string>>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((x) => /washer/i.test(x.part))).toBe(true);
    expect(Object.keys(rows[0])).toEqual(expect.arrayContaining(['part', 'price', 'stock']));
    const empty = await runIntegration('search_parts', { query: 'zzzz' });
    expect(empty).toMatchObject({ ok: true, results: [] });
    const missing = await runIntegration('search_parts', {});
    expect(missing).toMatchObject({ ok: false, kind: 'input' });
    const last = readRuns().at(-1)!;
    expect(last).toMatchObject({ ok: false, name: 'search_parts' });
    expect(JSON.stringify(readRuns())).not.toContain('Washer');
  });

  it('signs in using secrets from env only', async () => {
    await mint({ name: 'list_orders', url: `${base}/orders`, task: 'List my orders', exampleInput: {}, auth: { url: `${base}/login`, secretNames: ['USERNAME', 'PASSWORD'] }, log: silent });
    expect(readFileSync(join(dir, 'list_orders/integration.json'), 'utf8')).not.toContain('demo-pass');
    expect(((await runIntegration('list_orders', {})).results as unknown[]).length).toBe(6);
    const saved = process.env.MINTER_SECRET_LIST_ORDERS_PASSWORD;
    delete process.env.MINTER_SECRET_LIST_ORDERS_PASSWORD;
    const r = await runIntegration('list_orders', {});
    process.env.MINTER_SECRET_LIST_ORDERS_PASSWORD = saved;
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/missing secret/);
  });

  it('level-1 healing patches selectors when the site changes (v2)', async () => {
    const before = loadIntegration('search_parts');
    demo.setVersion(2);
    const r = await runIntegration('search_parts', { query: 'bolt' });
    expect(r.ok).toBe(true);
    expect(r.meta.healed).toBe('selectors');
    const after = loadIntegration('search_parts');
    expect(after.version).toBeGreaterThan(before.version);
    expect(after.history.some((h) => h.reason === 'heal:selectors')).toBe(true);
    expect(JSON.stringify(after.steps)).not.toContain('"#q"');
    // the auth flow heals too
    expect(((await runIntegration('list_orders', {})).results as unknown[]).length).toBe(6);
  });

  it('level-2 healing re-mints when hints cannot re-locate', async () => {
    demo.setVersion(1);
    const integ = loadIntegration('search_parts');
    // corrupt selectors AND hints so level 1 cannot succeed
    for (const s of integ.steps) if ('target' in s) { s.target.selector = '#nothing-here'; s.target.hints = { role: 'link', name: 'No such thing' }; }
    saveIntegration(integ);
    const r = await runIntegration('search_parts', { query: 'seal' });
    expect(r.ok).toBe(true);
    expect(r.meta.healed).toBe('remint');
    expect(loadIntegration('search_parts').history.at(-1)!.reason).toBe('heal:remint');
  }, 120000);

  it('fails cleanly with --no-heal semantics', async () => {
    const integ = loadIntegration('search_parts');
    const f = join(dir, 'search_parts/integration.json');
    writeFileSync(f, JSON.stringify({ ...integ, url: `${base}/nope-404` }));
    const r = await runIntegration('search_parts', { query: 'x' }, { heal: false });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/step \d/);
  });
});

describe('MCP server (in-memory transport)', () => {
  it('lists tools, calls them, builds a new tool at runtime', async () => {
    demo.setVersion(1);
    await mint({ name: 'search_parts', url: `${base}/catalog`, task: 'Search the parts catalog', exampleInput: { query: 'bolt' }, log: silent });
    const server = buildMcpServer();
    const client = new Client({ name: 't', version: '0' });
    let changed = 0;
    const [a, b] = InMemoryTransport.createLinkedPair();
    const { ToolListChangedNotificationSchema } = await import('@modelcontextprotocol/sdk/types.js');
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => { changed++; });
    await Promise.all([server.connect(a), client.connect(b)]);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['search_parts', 'list_orders', 'build_website_tool', 'list_website_tools', 'run_website_tool']));
    const res = await client.callTool({ name: 'search_parts', arguments: { query: 'bearing' } });
    expect((res.structuredContent as { results: unknown[] }).results.length).toBeGreaterThanOrEqual(1);
    const viaRun = await client.callTool({ name: 'run_website_tool', arguments: { name: 'search_parts', input: { query: 'nut' } } });
    expect((viaRun.structuredContent as { ok: boolean }).ok).toBe(true);
    const built = await client.callTool({ name: 'build_website_tool', arguments: { name: 'find_seals', url: `${base}/catalog`, task: 'Find seals', exampleInput: { query: 'seal' } } });
    expect(built.isError).toBeFalsy();
    await new Promise((r) => setTimeout(r, 200));
    expect(changed).toBeGreaterThan(0);
    expect((await client.listTools()).tools.map((t) => t.name)).toContain('find_seals');
    await client.close();
  });
});

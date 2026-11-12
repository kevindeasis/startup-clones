import type { Server } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { getConfig } from '../config.js';
import { listIntegrations } from '../integration.js';
import { runIntegration } from '../runner.js';
import { callStats, recentRuns } from '../runlog.js';
import { buildMcpServer } from './server.js';

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function dashboard(): string {
  const integs = listIntegrations();
  const runs = recentRuns(20);
  const rows = integs
    .map((i) => {
      const s = callStats(i.name);
      return `<tr><td><code>${esc(i.name)}</code> v${i.version}</td><td>${esc(i.url)}</td><td>${esc(i.task)}</td><td>${esc(i.createdAt.slice(0, 10))}</td><td>${s.calls24h} / ${s.calls30d}</td><td>${esc(s.lastStatus)}</td></tr>`;
    })
    .join('');
  const runRows = runs
    .map(
      (r) =>
        `<tr><td>${esc(r.at.replace('T', ' ').slice(0, 19))}</td><td><code>${esc(r.name)}</code> v${r.version}</td><td>${r.ok ? 'ok' : 'failed'}</td><td>${r.ms} ms</td><td>${esc(r.healed ?? '')}</td><td>${r.resultCount}</td><td>${esc(r.error ?? '')}</td></tr>`,
    )
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Minter dashboard</title><style>
:root{--bg:#fff;--fg:#1a1a1a;--mut:#666;--line:#ddd;--acc:#0b5fff}
@media (prefers-color-scheme:dark){:root{--bg:#14161a;--fg:#e8e8e8;--mut:#9aa0a6;--line:#2c3036;--acc:#6ea0ff}}
body{font:15px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--fg);margin:0 auto;max-width:1100px;padding:16px}
table{border-collapse:collapse;width:100%;margin:8px 0 24px;display:block;overflow-x:auto}th,td{border-bottom:1px solid var(--line);padding:6px 10px;text-align:left;font-size:14px}
th{color:var(--mut);font-weight:600}input,select,button,textarea{font:inherit;color:inherit;background:transparent;border:1px solid var(--line);border-radius:6px;padding:6px 10px}
button{background:var(--acc);color:#fff;border-color:var(--acc);cursor:pointer}pre{background:rgba(127,127,127,.12);padding:12px;border-radius:6px;overflow:auto}
</style></head><body><h1>Minter</h1><p style="color:var(--mut)">Websites minted into deterministic MCP tools. MCP endpoint: <code>POST /mcp</code></p>
<h2>Integrations</h2><table><thead><tr><th>Name</th><th>URL</th><th>Task</th><th>Created</th><th>Calls 24h / 30d</th><th>Last status</th></tr></thead><tbody>${rows || '<tr><td colspan="6">None yet. Run <code>npm run mint</code>.</td></tr>'}</tbody></table>
<h2>Last 20 runs</h2><table><thead><tr><th>When</th><th>Integration</th><th>Status</th><th>Time</th><th>Healed</th><th>Results</th><th>Error</th></tr></thead><tbody>${runRows || '<tr><td colspan="7">No runs yet.</td></tr>'}</tbody></table>
<h2>Run an integration</h2><form id="f"><select id="n">${integs.map((i) => `<option>${esc(i.name)}</option>`).join('')}</select>
<input id="i" size="40" value="{}" aria-label="JSON input"> <button>Run</button></form><pre id="o">Output appears here.</pre>
<script>document.getElementById('f').onsubmit=async function(e){e.preventDefault();var o=document.getElementById('o');o.textContent='Running...';
try{var r=await fetch('/api/run',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:document.getElementById('n').value,input:JSON.parse(document.getElementById('i').value||'{}')})});
o.textContent=JSON.stringify(await r.json(),null,2)}catch(x){o.textContent=String(x)}};</script></body></html>`;
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.all('/mcp', async (req, res) => {
    const server = buildMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      if (!res.headersSent)
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: e instanceof Error ? e.message : 'internal error' }, id: null });
    }
  });

  app.get('/', (_req, res) => res.type('html').send(dashboard()));
  app.get('/api/integrations', (_req, res) =>
    res.json(listIntegrations().map((i) => ({ name: i.name, version: i.version, url: i.url, task: i.task, createdAt: i.createdAt, ...callStats(i.name) }))),
  );
  app.get('/api/runs', (req, res) => res.json(recentRuns(Math.min(200, Number(req.query.limit) || 20))));
  app.post('/api/run', async (req, res) => {
    const { name, input } = req.body ?? {};
    if (typeof name !== 'string') return res.status(400).json({ ok: false, error: 'name required' });
    const r = await runIntegration(name, input ?? {});
    res.status(r.ok ? 200 : 422).json(r);
  });
  return app;
}

export function startHttp(port = getConfig().port): Promise<Server> {
  return new Promise((resolve) => {
    const s = createApp().listen(port, () => {
      console.error(`[minter] dashboard http://localhost:${port}/  MCP http://localhost:${port}/mcp`);
      resolve(s);
    });
  });
}

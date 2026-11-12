import type { Server } from 'node:http';
import express from 'express';
import { getConfig } from '../config.js';

interface Part { name: string; sku: string; price: number; stock: number; category: string; desc: string }
const NAMES: Array<[string, string]> = [
  ['Hex Bolt M6', 'Fasteners'], ['Hex Bolt M8', 'Fasteners'], ['Carriage Bolt 10mm', 'Fasteners'], ['Eye Bolt M10', 'Fasteners'],
  ['Flat Washer M6', 'Fasteners'], ['Flat Washer M8', 'Fasteners'], ['Spring Washer M10', 'Fasteners'], ['Lock Washer M6', 'Fasteners'],
  ['Hex Nut M6', 'Fasteners'], ['Hex Nut M8', 'Fasteners'], ['Wing Nut M5', 'Fasteners'], ['Nylon Lock Nut M8', 'Fasteners'],
  ['Deep Groove Bearing 6204', 'Bearings'], ['Deep Groove Bearing 6205', 'Bearings'], ['Tapered Roller Bearing 30205', 'Bearings'], ['Needle Bearing HK1010', 'Bearings'],
  ['Thrust Bearing 51105', 'Bearings'], ['Pillow Block Bearing UCP204', 'Bearings'],
  ['Nitrile O-Ring Seal 20mm', 'Seals'], ['Shaft Seal 25x40x7', 'Seals'], ['Silicone Gasket Seal 50mm', 'Seals'], ['Hydraulic Rod Seal 30mm', 'Seals'],
  ['Viton O-Ring Seal 12mm', 'Seals'], ['Dust Seal 35mm', 'Seals'],
];
export const PARTS: Part[] = NAMES.map(([name, category], i) => ({
  name, category, sku: `AC-${1000 + i * 7}`, price: Math.round((0.35 + ((i * 37) % 90) / 4) * 100) / 100, stock: (i * 53) % 400,
  desc: `${name} from the Acme ${category.toLowerCase()} range. Industrial grade.`,
}));

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const ORDERS = [
  ['ORD-2041', '2026-10-02', 'Delivered', '$212.40'], ['ORD-2042', '2026-10-09', 'Delivered', '$58.10'], ['ORD-2043', '2026-10-17', 'Shipped', '$1,204.00'],
  ['ORD-2044', '2026-10-28', 'Processing', '$89.95'], ['ORD-2045', '2026-11-03', 'Processing', '$402.30'], ['ORD-2046', '2026-11-09', 'Backordered', '$37.60'],
];

function layout(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)} - Acme Industrial Parts</title></head><body>
<header><h1>Acme Industrial Parts Portal</h1><nav><a href="/">Home</a> | <a href="/catalog">Catalog</a> | <a href="/orders">My orders</a> | <a href="/login">Sign in</a></nav></header>
<main>${body}</main><footer><p>Acme Industrial Parts. Demo site for the Minter clone.</p></footer></body></html>`;
}

export interface DemoHandle { server: Server; port: number; setVersion(v: 1 | 2): void; close(): Promise<void> }

export function createDemoApp(state: { version: 1 | 2 }) {
  const cfg = getConfig();
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  const COOKIE = 'acme_session=ok';
  const authed = (h?: string) => (h ?? '').split(';').some((c) => c.trim() === COOKIE);

  app.get('/', (_q, r) => r.send(layout('Home', '<h2>Welcome</h2><p>Browse the <a href="/catalog">parts catalog</a> or view your <a href="/orders">orders</a>.</p>')));

  app.get('/catalog', (req, res) => {
    const v = state.version;
    const q = typeof req.query.q === 'string' ? req.query.q : typeof req.query.search === 'string' ? req.query.search : undefined;
    const cat = typeof req.query.category === 'string' ? req.query.category : 'All';
    const field = v === 1 ? 'q' : 'search';
    const form = `<form ${v === 1 ? 'id="search-form"' : 'class="finder"'} method="get" action="/catalog">
<label for="${v === 1 ? 'q' : 'part-search'}">Search parts</label>
<input type="text" ${v === 1 ? 'id="q" name="q"' : 'id="part-search" name="search"'} placeholder="Part name" value="${esc(q ?? '')}">
<label for="category">Category</label>
<select id="category" name="category">${['All', 'Fasteners', 'Bearings', 'Seals'].map((c) => `<option${c === cat ? ' selected' : ''}>${c}</option>`).join('')}</select>
<button type="submit">Search</button></form>`;
    let results = '';
    if (q !== undefined) {
      const found = PARTS.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()) && (cat === 'All' || p.category === cat));
      const body = found.length
        ? found.map((p) => `<tr><td><a href="/parts/${p.sku}">${esc(p.name)}</a></td><td>${p.sku}</td><td>$${p.price.toFixed(2)}</td><td>${p.stock}</td><td>${p.category}</td></tr>`).join('')
        : '<tr class="empty"><td colspan="5">No parts found</td></tr>';
      results = `<table ${v === 1 ? 'id="results"' : 'class="parts-grid"'}><thead><tr><th>Part</th><th>SKU</th><th>Price</th><th>Stock</th><th>Category</th></tr></thead><tbody>${body}</tbody></table>`;
    }
    void field;
    res.send(layout('Catalog', `<h2>Parts catalog</h2>${form}${results}`));
  });

  app.get('/parts/:sku', (req, res) => {
    const p = PARTS.find((x) => x.sku === req.params.sku);
    if (!p) return res.status(404).send(layout('Not found', '<p>No such part.</p>'));
    res.send(layout(p.name, `<h2>${esc(p.name)}</h2><p>SKU: ${p.sku}</p><p>Price: $${p.price.toFixed(2)}</p><p>Stock: ${p.stock}</p><p>${esc(p.desc)}</p>`));
  });

  const loginPage = (err = '') => {
    const v = state.version;
    return layout('Sign in', `<h2>Sign in</h2>${err ? `<p role="alert">${esc(err)}</p>` : ''}<form method="post" action="/login">
<label for="${v === 1 ? 'username' : 'user-field'}">Username</label><input type="text" ${v === 1 ? 'id="username" name="username"' : 'id="user-field" name="uname"'}>
<label for="${v === 1 ? 'password' : 'pw-field'}">Password</label><input type="password" ${v === 1 ? 'id="password" name="password"' : 'id="pw-field" name="pword"'}>
<button type="submit">Sign in</button></form>`);
  };
  app.get('/login', (_q, r) => r.send(loginPage()));
  app.post('/login', (req, res) => {
    const u = req.body.username ?? req.body.uname;
    const p = req.body.password ?? req.body.pword;
    if (u === cfg.demoUser && p === cfg.demoPass) {
      res.setHeader('Set-Cookie', `${COOKIE}; Path=/; HttpOnly`);
      return res.redirect('/orders');
    }
    res.status(401).send(loginPage('Invalid username or password'));
  });
  app.get('/orders', (req, res) => {
    if (!authed(req.headers.cookie)) return res.redirect('/login');
    const v = state.version;
    res.send(layout('Orders', `<h2>My orders</h2><table ${v === 1 ? 'id="orders"' : 'class="order-grid"'}><thead><tr><th>Order</th><th>Date</th><th>Status</th><th>Total</th></tr></thead><tbody>${ORDERS.map((o) => `<tr>${o.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`));
  });
  return app;
}

export function startDemoSite(port = getConfig().demoPort, version: 1 | 2 = getConfig().demoVersion as 1 | 2): Promise<DemoHandle> {
  const state = { version };
  const app = createDemoApp(state);
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      const addr = server.address();
      const actual = typeof addr === 'object' && addr ? addr.port : port;
      resolve({
        server,
        port: actual,
        setVersion: (v) => void (state.version = v),
        close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
      });
    });
  });
}

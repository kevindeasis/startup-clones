// Acceptance checks. Usage: BASE_URL=http://localhost:3111 npm run smoke
import { spawn, spawnSync } from "node:child_process";
import assert from "node:assert/strict";

const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const AUTH = { authorization: "Bearer dev-key" };
const J = { "content-type": "application/json" };
let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); pass++; console.log(`PASS ${name}`); }
  catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`); }
}
const post = (p, body, h = {}) => fetch(BASE + p, { method: "POST", headers: { ...J, ...h }, body: JSON.stringify(body) });
const word = "zebracrossing" + Date.now().toString(36);
const HTML = `<!doctype html><html><head><title>t</title></head><body><h1>Smoke ${word} heading</h1><p>First sentence of the paragraph. Second sentence is here to be removed. Third one too.</p><p>Another block.</p></body></html>`;
let sp, sp2;

await check("1 health", async () => {
  const r = await fetch(BASE + "/api/health"); assert.equal(r.status, 200);
  assert.equal(typeof (await r.json()).mock, "boolean");
});
await check("2 publish requires bearer; with key -> 201", async () => {
  assert.equal((await post("/api/spaces", { title: "Smoke", html: HTML })).status, 401);
  const r = await post("/api/spaces", { title: "Smoke Test " + word, html: HTML }, AUTH);
  assert.equal(r.status, 201); sp = await r.json();
  assert.ok(sp.slug); assert.equal(sp.version, 1);
});
let v1;
await check("3 raw html has data-block b1", async () => {
  const r = await fetch(`${BASE}/api/raw/${sp.slug}`); assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /text\/html/);
  v1 = await r.text(); assert.ok(v1.includes('data-block="b1"'));
});
await check("4 /s/:slug renders title", async () => {
  const r = await fetch(`${BASE}/s/${sp.slug}`); assert.equal(r.status, 200);
  assert.ok((await r.text()).includes("Smoke Test"));
});
await check("5 plain comment -> 201, no agent reply", async () => {
  const r = await post(`/api/spaces/${sp.id}/comments`, { block: "b1", author: "Kevin", body: "looks good" });
  assert.equal(r.status, 201); assert.ok(!(await r.json()).reply);
});
await check("6 @paddock edit -> version 2 with diff", async () => {
  const r = await post(`/api/spaces/${sp.id}/comments`, { block: "b2", author: "Kevin", body: "@paddock make this shorter" });
  assert.equal(r.status, 201); const d = await r.json();
  assert.equal(d.reply.meta.version_created, 2); assert.ok(d.reply.meta.diff.trim().length > 0);
  const raw = await (await fetch(`${BASE}/api/raw/${sp.slug}`)).text();
  assert.notEqual(raw, v1); assert.ok(raw.includes('data-block="b1"') && raw.includes('data-block="b2"'));
});
await check("7 versions list = 2; v1 is original", async () => {
  const vs = await (await fetch(`${BASE}/api/spaces/${sp.id}/versions`)).json(); assert.equal(vs.length, 2);
  assert.equal(await (await fetch(`${BASE}/api/spaces/${sp.id}/versions/1`)).text(), v1);
});
await check("8 restore -> version 3 equals v1", async () => {
  const r = await post(`/api/spaces/${sp.id}/versions/1/restore`, {});
  const d = await r.json(); assert.equal(d.version, 3);
  assert.equal(await (await fetch(`${BASE}/api/spaces/${sp.id}/versions/3`)).text(), v1);
});
await check("9 new version via API -> 4; since=3 changed", async () => {
  const r = await post(`/api/spaces/${sp.id}/versions`, { html: HTML.replace("Another block", "Changed block"), note: "smoke" }, AUTH);
  assert.equal((await r.json()).version, 4);
  const s = await (await fetch(`${BASE}/api/spaces/${sp.id}?since=3`)).json();
  assert.deepEqual(s, { changed: true, version: 4 });
});
await check("10 visibility + search", async () => {
  const r2 = await post("/api/spaces", { title: "Private twin", html: HTML }, AUTH); sp2 = await r2.json();
  const p = await fetch(`${BASE}/api/spaces/${sp.id}`, { method: "PATCH", headers: J, body: JSON.stringify({ visibility: "public" }) });
  assert.equal(p.status, 200);
  const hits = await (await fetch(`${BASE}/api/search?q=${word}`)).json();
  assert.ok(hits.some((h) => h.id === sp.id)); assert.ok(!hits.some((h) => h.id === sp2.id));
  const all = await (await fetch(`${BASE}/api/search?q=${word}&all=1`)).json();
  assert.ok(all.some((h) => h.id === sp2.id));
});
await check("11 comments = 3 (2 user, 1 agent); resolve works", async () => {
  const cs = await (await fetch(`${BASE}/api/spaces/${sp.id}/comments`)).json();
  assert.equal(cs.length, 3); assert.equal(cs.filter((c) => c.kind === "user").length, 2); assert.equal(cs.filter((c) => c.kind === "agent").length, 1);
  const r = await fetch(`${BASE}/api/spaces/${sp.id}/comments/${cs[0].id}`, { method: "PATCH", headers: J, body: JSON.stringify({ resolved: true }) });
  assert.equal(r.status, 200); assert.equal((await r.json()).resolved, true);
});
await check("14 malformed and unknown block ids -> 400", async () => {
  const bad = await post(`/api/spaces/${sp.id}/comments`, { block: 'b1"] , [x="', author: "t", body: "@paddock hi" });
  assert.equal(bad.status, 400);
  const unk = await post(`/api/spaces/${sp.id}/comments`, { block: "b999", author: "t", body: "@paddock hi" });
  assert.equal(unk.status, 400);
  const whole = await post(`/api/spaces/${sp2.id}/comments`, { author: "t", body: "@paddock uppercase" });
  assert.equal(whole.status, 201);
});
await check("12 deploy CLI prints working URL", async () => {
  const r = spawnSync("node", ["scripts/deploy.mjs", "samples/design-doc.html", "--title", "Deploy test"], { env: { ...process.env, PADDOCK_URL: BASE }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const url = r.stdout.trim(); assert.match(url, /^https?:\/\//);
  assert.equal((await fetch(url)).status, 200);
});
await check("13 MCP server lists 7 tools", async () => {
  const child = spawn("node", ["mcp/server.mjs"], { env: { ...process.env, PADDOCK_URL: BASE }, stdio: ["pipe", "pipe", "inherit"] });
  let buf = ""; const msgs = [];
  child.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l.trim()) msgs.push(JSON.parse(l)); } });
  const send = (o) => child.stdin.write(JSON.stringify(o) + "\n");
  const wait = async (id) => { for (let i = 0; i < 100; i++) { const m = msgs.find((x) => x.id === id); if (m) return m; await new Promise((r) => setTimeout(r, 50)); } throw new Error("timeout waiting for " + id); };
  try {
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "smoke", version: "0" } } });
    await wait(1);
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const names = (await wait(2)).result.tools.map((t) => t.name).sort();
    assert.deepEqual(names, ["create_space", "create_version", "get_space", "list_comments", "list_spaces", "reply_comment", "restore_version"]);
  } finally { child.kill(); }
});
console.log(`\n${pass} passed, ${fail} failed (build/lint: run npm run build && npm run lint separately)`);
process.exit(fail ? 1 : 0);

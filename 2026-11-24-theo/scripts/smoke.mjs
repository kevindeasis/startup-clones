// Smoke test for acceptance checks 2-8. Usage: BASE_URL=http://localhost:3000 node scripts/smoke.mjs
import { existsSync } from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL || "http://localhost:3000";
let failed = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!cond) failed++;
};
const post = async (p, body) => {
  const r = await fetch(BASE + p, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { r, j: r.headers.get("content-type")?.includes("json") ? await r.json() : null };
};

const business = {
  name: `Smoke Plumbing ${Date.now() % 100000}`, industry: "plumber", city: "Springfield", region: "IL",
  phone: "(217) 555-0142", email: "hello@example.com", hours: "Mon-Fri 8am-6pm", tone: "friendly",
  services: ["drain cleaning", "pipe repair", "leak detection"],
};

try {
  // 2. health
  const h = await (await fetch(BASE + "/api/health")).json();
  ok("2. GET /api/health", h.ok === true && h.mock === true, JSON.stringify(h));

  // 3. directions
  const d = await post("/api/design-directions", { business });
  ok("3. design-directions returns exactly 3", d.r.status === 200 && d.j.directions?.length === 3);

  // 4. create site + render
  const c = await post("/api/sites", { business, direction: d.j.directions[0] });
  const site = c.j;
  ok("4a. POST /api/sites >= 6 pages", c.r.status === 200 && site.pages?.length >= 6, `pages=${site.pages?.length}`);
  const home = await fetch(`${BASE}/s/${site.slug}`);
  const html = await home.text();
  ok("4b. GET /s/<slug> 200 with name, meta description, LocalBusiness JSON-LD",
    home.status === 200 && html.includes(business.name) && /<meta name="description"/.test(html) && html.includes('"@type":"LocalBusiness"'));
  const svc = await fetch(`${BASE}/s/${site.slug}/services/drain-cleaning`);
  ok("4c. GET /s/<slug>/services/drain-cleaning 200", svc.status === 200);

  // 5. chat + revert
  const v0 = site.versions.length;
  const ch = await post(`/api/sites/${site.id}/chat`, { message: "add a water heater repair service" });
  ok("5a. chat adds service page + new version",
    ch.r.status === 200 && ch.j.site.pages.some((p) => p.path === "/services/water-heater-repair") && ch.j.site.versions.length === v0 + 1, ch.j?.summary);
  const wh = await fetch(`${BASE}/s/${site.slug}/services/water-heater-repair`);
  ok("5b. new service page is served", wh.status === 200);
  const rv = await post(`/api/sites/${site.id}/revert`, { versionId: site.versions[0].id });
  ok("5c. revert restores previous version", rv.r.status === 200 && !rv.j.pages.some((p) => p.path === "/services/water-heater-repair") && rv.j.pages.length === site.pages.length);

  // 6. growth
  const g = await post(`/api/sites/${site.id}/growth/run`);
  const kinds = new Set(g.j.drafts.map((x) => x.kind));
  ok("6a. growth run >= 3 drafts, >= 2 kinds", g.r.status === 200 && g.j.drafts.length >= 3 && kinds.size >= 2, `drafts=${g.j.drafts.length} kinds=${[...kinds]}`);
  const pd = g.j.drafts.find((x) => x.kind === "page");
  const pub = await post(`/api/sites/${site.id}/growth/${pd.id}`, { action: "publish" });
  ok("6b. publish page draft", pub.r.status === 200 && pub.j.pages.some((p) => p.path === pd.page.path));
  const seo = await fetch(`${BASE}/s/${site.slug}${pd.page.path}`);
  ok("6c. published page reachable", seo.status === 200, pd.page.path);
  const sm = await (await fetch(`${BASE}/s/${site.slug}/sitemap.xml`)).text();
  ok("6d. listed in sitemap.xml", sm.includes(`/s/${site.slug}${pd.page.path}`));
  const g2 = await post(`/api/sites/${site.id}/growth/run`);
  ok("6e. second run still yields >= 3 drafts", g2.j.drafts.length >= 3);

  // 7. audit
  const sample = `<html><head><title>Joe's Plumbing</title></head><body><h1>Plumbing</h1><h1>Again</h1><img src="a.png"><p>We do repair and cleaning in Springfield, IL.</p><a href="/about">About</a></body></html>`;
  const a = await post("/api/audit", { html: sample });
  ok("7. audit score 0-100, >= 8 checks, >= 3 fixes", a.r.status === 200 && a.j.score >= 0 && a.j.score <= 100 && a.j.checks.length >= 8 && a.j.fixes.length >= 3, `score=${a.j.score} checks=${a.j.checks?.length} fixes=${a.j.fixes?.length}`);

  // 8. export
  const ex = await fetch(`${BASE}/api/sites/${site.id}/export`, { method: "POST" });
  const buf = Buffer.from(await ex.arrayBuffer());
  ok("8a. export returns zip", ex.status === 200 && ex.headers.get("content-type") === "application/zip" && buf.subarray(0, 2).toString() === "PK", `${buf.length} bytes`);
  const dir = path.join(process.cwd(), "exports", site.slug);
  ok("8b. exports/<slug>/ has index.html, sitemap.xml, robots.txt", ["index.html", "sitemap.xml", "robots.txt"].every((f) => existsSync(path.join(dir, f))));
} catch (e) {
  console.log("FAIL  unexpected error:", e);
  failed++;
}
console.log(failed ? `\n${failed} check(s) failed` : "\nAll smoke checks passed");
process.exit(failed ? 1 : 0);

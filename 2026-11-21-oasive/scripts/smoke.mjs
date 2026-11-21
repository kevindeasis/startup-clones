// HTTP smoke test. Expects the app (npm run start / dev) on PORT (default 3000), already seeded.
import { PDFDocument, StandardFonts } from "pdf-lib";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
let passed = 0;

function check(cond, msg) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${msg}`);
}

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, opts);
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* non-json */
  }
  return { status: res.status, body };
}
const post = (path, data) =>
  api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
const norm = (s) => s.replace(/\s+/g, " ").trim().toLowerCase();

async function pageText(docId, page) {
  const r = await api(`/api/documents/${docId}/page/${page}`);
  return r.status === 200 ? r.body.text : null;
}

async function upload(obligorId, filename, mime, data, fields) {
  const fd = new FormData();
  fd.set("file", new Blob([data], { type: mime }), filename);
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return api(`/api/obligors/${obligorId}/documents`, { method: "POST", body: fd });
}

// 1. health
const health = await api("/api/health");
check(health.status === 200 && health.body.ok === true && health.body.mode === "mock", "health is ok and mode is mock");

// 2. directory
const list = await api("/api/obligors");
check(list.body.obligors.length === 6, "directory lists 6 obligors");
const hospital = list.body.obligors.find((o) => o.sector === "hospital");
check(!!hospital, "a hospital obligor exists");

// 3. hospital days cash on hand with verified citations
const hd = await api(`/api/obligors/${hospital.id}`);
check(hd.status === 200, "obligor detail returns 200");
const dch = hd.body.metrics.filter((m) => m.name.toLowerCase() === "days cash on hand");
check(new Set(dch.map((m) => m.fiscalYear)).size >= 2, "hospital has days cash on hand for >= 2 fiscal years");
for (const m of dch) {
  const t = await pageText(m.citation.docId, m.citation.page);
  check(t && norm(t).includes(norm(m.citation.quote)) && m.citation.verified, `FY${m.fiscalYear} days cash citation quote is on page ${m.citation.page}`);
}

// 4. upload .txt with page markers
const target = list.body.obligors.find((o) => o.sector === "city");
const txt = "Smoke Test Report\n=== Page 1 ===\nCover page with nothing relevant.\n=== Page 2 ===\nLiquidity\nDays cash on hand: 97\nEnd of page.\n";
const up = await upload(target.id, "smoke.txt", "text/plain", txt, { type: "audit", fiscalYear: "2031", title: "Smoke upload" });
check(up.status === 201, "text upload returns 201");
const m97 = up.body.metrics.find((m) => m.name === "Days cash on hand" && m.value === 97);
check(m97 && m97.citation.verified && m97.citation.page === 2 && m97.fiscalYear === 2031, "uploaded metric is verified on page 2 with fiscal year 2031");
const after = await api(`/api/obligors/${target.id}`);
check(after.body.metrics.some((m) => m.value === 97 && m.fiscalYear === 2031), "obligor page shows the new metric");

// 5. upload a generated PDF
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
pdf.addPage().drawText("Smoke PDF page one. Enrollment: 4,321", { x: 50, y: 700, size: 12, font });
pdf.addPage().drawText("Smoke PDF page two. Operating margin: 4.5%", { x: 50, y: 700, size: 12, font });
const pdfBytes = await pdf.save();
const pup = await upload(target.id, "smoke.pdf", "application/pdf", pdfBytes, { type: "other", fiscalYear: "2030" });
check(pup.status === 201 && pup.body.document.pageCount === 2 && pup.body.document.chunkCount >= 1, "PDF upload extracts 2 pages and indexes >= 1 chunk");
const pdoc = await api(`/api/documents/${pup.body.document.id}`);
check(pdoc.body.pages.join(" ").includes("Smoke PDF page one"), "PDF text was extracted");
check(pup.body.metrics.some((m) => m.name === "Operating margin" && m.value === 4.5 && m.citation.page === 2), "PDF metric extracted from page 2");

// 6. news ingest: downgrade
const city = list.body.obligors.find((o) => o.name === "City of Ashford Falls") ?? target;
const down = await post("/api/news/ingest", {
  title: `Moody's downgrades ${city.name} after budget shortfall`,
  text: `Moody's Ratings downgraded ${city.name} by one notch, citing a $9 million shortfall. The outlook remains negative.`,
  source: "Smoke Wire", publishedAt: new Date().toISOString(),
});
check(down.status === 201 && down.body.item.creditRelevant === true && down.body.item.eventType === "rating" && down.body.item.obligorIds.includes(city.id), "pasted downgrade is credit relevant, type rating, tagged to the obligor");
const cd = await api(`/api/obligors/${city.id}`);
check(cd.body.events.some((e) => e.source.kind === "news" && e.source.newsId === down.body.item.id), "downgrade event appears on the obligor page");

// 7. bake sale
const bake = await post("/api/news/ingest", { title: "Church bake sale raises money", text: "Volunteers sold cookies and pies on Sunday morning.", source: "Smoke Wire" });
check(bake.status === 201 && bake.body.item.creditRelevant === false, "bake sale story is not credit relevant");

// 8. watchlists
const [o1, o2] = list.body.obligors.slice(0, 2);
const wl = await post("/api/watchlists", { name: "Smoke list" });
check(wl.status === 201, "watchlist created");
const add = await api(`/api/watchlists/${wl.body.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ add: [o1.id, o2.id] }) });
check(add.body.obligorIds.length === 2, "two obligors added to the watchlist");
const feed = await api(`/api/news?watchlistId=${wl.body.id}&includeFiltered=true`);
check(feed.body.items.length > 0 && feed.body.items.every((n) => n.obligorIds.some((id) => id === o1.id || id === o2.id)), "feed filtered by watchlist contains only those obligors' items");
const rem = await api(`/api/watchlists/${wl.body.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ remove: [o1.id] }) });
check(rem.body.obligorIds.length === 1 && rem.body.obligorIds[0] === o2.id, "remove from watchlist works");
const del = await api(`/api/watchlists/${wl.body.id}`, { method: "DELETE" });
check(del.status === 200, "watchlist deleted");

// 9. ask
const ask = await post(`/api/obligors/${hospital.id}/ask`, { question: "What is the days cash on hand?" });
check(ask.status === 200 && ask.body.mode === "mock" && ask.body.citations.length >= 1, "ask returns >= 1 citation");
for (const c of ask.body.citations) {
  const t = await pageText(c.docId, c.page);
  check(t && norm(t).includes(norm(c.quote)), `citation [${c.n}] quote occurs on ${c.docTitle} p.${c.page}`);
}

// 10. compare
const two = await post("/api/ask", { question: "Describe the fund balance and debt service coverage", obligorIds: [o1.id, o2.id] });
check(two.status === 200 && two.body.results.length === 2, "/api/ask with two obligors returns two results");

// 11. errors
const ssrf = await post("/api/news/ingest", { url: "http://127.0.0.1/x" });
check(ssrf.status === 400, "URL ingest of 127.0.0.1 returns 400");
const nf = await api("/api/obligors/does-not-exist");
check(nf.status === 404, "unknown obligor returns 404");
const nf2 = await post("/api/obligors/does-not-exist/ask", { question: "anything at all" });
check(nf2.status === 404, "ask on unknown obligor returns 404");

console.log(`${passed} checks passed`);
console.log("SMOKE PASSED");

// End-to-end smoke test. Usage: BASE_URL=http://localhost:3000 npm run smoke
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
const dir = path.join(process.cwd(), "src", "data", "sample-emails");
const email = (f) => fs.readFileSync(path.join(dir, f), "utf8");
let passed = 0;

function check(cond, msg) {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  passed++;
  console.log(`  ok  ${msg}`);
}

async function api(method, url, body) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function main() {
  console.log(`Smoke test against ${BASE}`);

  // a. restaurant extraction
  const a = await api("POST", "/api/extract", { text: email("01-restaurant.txt") });
  check(a.status === 200, "extract restaurant -> 200");
  check(a.json.profile.requestedLines.includes("bop") && a.json.profile.requestedLines.includes("liquor"), "restaurant requests bop + liquor");
  check(a.json.profile.industry === "restaurant", "industry is restaurant");
  check(Boolean(a.json.profile.businessName), "businessName non-empty");
  const a2 = await api("POST", "/api/extract", { text: email("01-restaurant.txt") });
  check(JSON.stringify(a.json) === JSON.stringify(a2.json), "extract is deterministic (identical output twice)");

  // PDF attachment path (hand-built one-page PDF)
  const pdfText = "Payroll is $99k for the year";
  const pdf = buildPdf(pdfText);
  const ap = await api("POST", "/api/extract", { text: "We are Pdf Test Co, a bakery at 1 Main St, Reno, NV 89501.", attachments: [{ filename: "extra.pdf", base64: pdf.toString("base64") }] });
  check(ap.status === 200 && ap.json.profile.annualPayroll === 99000, "PDF attachment text (unpdf) feeds extraction");

  // b. e-commerce needs_info
  const b = await api("POST", "/api/extract", { text: email("03-ecommerce.txt") });
  check(b.json.missing.some((m) => m.field === "annualRevenue"), "ecommerce missing includes annualRevenue");
  const bo = await api("POST", "/api/opportunities", { text: email("03-ecommerce.txt") });
  check(bo.status === 201 && bo.json.opportunity.stage === "needs_info", "ecommerce opportunity stage needs_info");
  check(/revenue/i.test(bo.json.opportunity.followUpEmail), "follow-up email mentions revenue");

  // c. landscaper quotes
  const c = await api("POST", "/api/opportunities", { text: email("02-landscaper.txt") });
  const landId = c.json.opportunity.id;
  const cq = await api("POST", `/api/opportunities/${landId}/quote`);
  const quotes = cq.json.quotes;
  check(cq.status === 200 && quotes.length >= 3, `landscaper quotes >= 3 (got ${quotes.length})`);
  check(quotes.some((q) => q.status === "quoted" && q.premium > 0), "at least one quoted with premium > 0");
  check(quotes.every((q) => Array.isArray(q.log) && q.log.length > 0), "every quote has a non-empty log");
  check(cq.json.opportunity.stage === "quoted", "stage becomes quoted");

  // c2. restaurant: harborline declines
  const r = await api("POST", "/api/opportunities", { text: email("01-restaurant.txt") });
  const rq = await api("POST", `/api/opportunities/${r.json.opportunity.id}/quote`);
  const hb = rq.json.quotes.find((q) => q.carrierId === "harborline");
  check(hb && hb.status === "declined", "harborline declines restaurant with liquor");

  // d. compare
  const d = await api("POST", `/api/opportunities/${landId}/compare`);
  check(d.status === 200 && d.json.summary && d.json.proposalEmail, "compare returns summary + proposalEmail");
  check(quotes.some((q) => q.id === d.json.recommendedQuoteId), "recommendedQuoteId exists in quotes");

  // e. select
  const e = await api("PATCH", `/api/opportunities/${landId}`, { selectedQuoteId: d.json.recommendedQuoteId });
  check(e.status === 200 && e.json.opportunity.stage === "selected", "PATCH selectedQuoteId -> stage selected");
  const bad = await api("PATCH", `/api/opportunities/${landId}`, { selectedQuoteId: "nope" });
  check(bad.status === 400, "selecting unknown quote -> 400");
  const list = await api("GET", "/api/opportunities");
  check(list.json.opportunities.some((o) => o.id === landId), "GET /api/opportunities lists it");

  // f. book gaps
  const f = await api("POST", "/api/book/gaps");
  check(f.json.gaps.length >= 3, `gaps >= 3 (got ${f.json.gaps.length})`);
  const liquor = f.json.gaps.find((g) => g.line === "liquor");
  check(Boolean(liquor) && f.json.gaps.some((g) => g.line === "wc"), "gaps include liquor and wc");
  const o = await api("POST", "/api/book/gaps/outreach", { accountId: liquor.accountId, line: "liquor" });
  check(o.status === 200 && o.json.email.length > 20, "outreach email non-empty");

  // g. cinder needs_info
  const g = await api("POST", "/api/carriers/cinder/quote", { company_name: "Acme", lines_requested: ["cyber"] });
  check(g.status === 200 && g.json.status === "needs_info" && g.json.missing.includes("gross_revenue"), "cinder without gross_revenue -> needs_info");
  const g2 = await api("POST", "/api/carriers/cinder/quote", { company_name: "Acme", lines_requested: ["cyber"], gross_revenue: "x" });
  check(g2.status === 400, "cinder with wrong type -> 400");

  // pages
  for (const p of ["/", "/intake", "/book", "/portal/northstar"]) {
    const res = await fetch(`${BASE}${p}`);
    check(res.status === 200, `GET ${p} -> 200`);
  }

  console.log(`SMOKE PASSED (${passed} checks)`);
}

function buildPdf(line) {
  const stream = `BT /F1 12 Tf 72 700 Td (${line}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

main().catch((err) => {
  console.error(err.message);
  console.error("SMOKE FAILED");
  process.exit(1);
});

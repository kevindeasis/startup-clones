/* End-to-end smoke test against a running app. Env: BASE_URL (default http://localhost:$PORT), PORT (default 3000).
   Expects a freshly seeded store in mock mode (run `npm run seed` first; re-seed before re-running). */
import { readFileSync } from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
let failures = 0;
let n = 0;

async function step(name: string, fn: () => Promise<void>) {
  n++;
  try {
    await fn();
    console.log(`PASS ${String(n).padStart(2)} ${name}`);
  } catch (e) {
    failures++;
    console.log(`FAIL ${String(n).padStart(2)} ${name}: ${e instanceof Error ? e.message : e}`);
  }
}
function ok(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = any;
async function api(method: string, p: string, body?: unknown): Promise<{ status: number; data: J }> {
  const res = await fetch(BASE + p, {
    method,
    headers: body && !(body instanceof FormData) ? { "content-type": "application/json" } : undefined,
    body: body ? (body instanceof FormData ? body : JSON.stringify(body)) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

async function main() {
  console.log(`Smoke test against ${BASE}`);
  let rfpId = "";
  let addendumText = "";
  let pursuitId = "";
  let taskIds: string[] = [];
  let brightwaterId = "";
  let pursuitBefore: J;

  await step("health reports mode mock and seeded counts", async () => {
    const { status, data } = await api("GET", "/api/health");
    ok(status === 200 && data.ok, "health not ok");
    ok(data.mode === "mock", `mode is ${data.mode}`);
    ok(data.counts.documents >= 9 && data.counts.signals >= 8, `counts: ${JSON.stringify(data.counts)}; run npm run seed`);
  });

  await step("locate RFP, Brightwater agency; store is fresh (no pursuits)", async () => {
    const docs = (await api("GET", "/api/documents")).data.documents;
    const rfp = docs.find((d: J) => d.kind === "solicitation" && /Mill Creek/.test(d.title));
    ok(rfp, "RFP not found");
    rfpId = rfp.id;
    brightwaterId = (await api("GET", "/api/agencies")).data.agencies.find((a: J) => a.name === "City of Brightwater")?.id;
    ok(brightwaterId, "Brightwater not found");
    const pursuits = (await api("GET", "/api/pursuits")).data.pursuits;
    ok(pursuits.length === 0, "store already has pursuits; run `npm run seed` to reset before smoke");
    addendumText = readFileSync(path.join(process.cwd(), "data/seed/documents/brightwater-rfp-addendum-1.md"), "utf8");
  });

  await step("signals?category=wastewater are all wastewater, sorted by fit desc", async () => {
    const { data } = await api("GET", "/api/signals?category=wastewater");
    ok(data.signals.length >= 2, "expected >=2 wastewater signals");
    ok(data.signals.every((s: J) => s.category === "wastewater"), "non-wastewater signal returned");
    for (let i = 1; i < data.signals.length; i++) ok(data.signals[i - 1].fitScore >= data.signals[i].fitScore, "not sorted by fit desc");
  });

  await step("signals: stages covered, RFP fit > Route 9 fit, Route 9 weak", async () => {
    const { signals } = (await api("GET", "/api/signals")).data;
    const stages = new Set(signals.map((s: J) => s.stage));
    ok(["discussion", "planned"].some((s) => stages.has(s)), "no discussion|planned");
    ok(["budgeted", "design"].some((s) => stages.has(s)), "no budgeted|design");
    ok(stages.has("solicitation"), "no solicitation");
    const lift = signals.find((s: J) => /Mill Creek/.test(s.projectTitle));
    const r9 = signals.find((s: J) => /Route 9/.test(s.projectTitle));
    ok(lift && r9, "missing lift-station or Route 9 signal");
    ok(lift.fitScore > r9.fitScore, `lift ${lift.fitScore} <= route9 ${r9.fitScore}`);
    ok(r9.fitScore < 40 && r9.band === "weak", `route 9 fit ${r9.fitScore}`);
    const q = (await api("GET", "/api/signals?q=booster")).data.signals;
    ok(q.length >= 1 && q.every((s: J) => /booster/i.test(JSON.stringify(s))), "search by q failed");
  });

  await step("ask 'When are bids due?' -> December 18 with page-1 citation", async () => {
    const { status, data } = await api("POST", `/api/documents/${rfpId}/ask`, { question: "When are bids due?" });
    ok(status === 200, `status ${status}`);
    ok(/December 18|2026-12-18/.test(data.answer), `answer: ${data.answer}`);
    ok(data.citations.some((c: J) => c.page === 1), `citations: ${JSON.stringify(data.citations)}`);
  });

  await step("ask about the roof warranty -> not found, no citations", async () => {
    const { data } = await api("POST", `/api/documents/${rfpId}/ask`, { question: "What is the warranty period for the roof?" });
    ok(/not found/i.test(data.answer), `answer: ${data.answer}`);
    ok(data.citations.length === 0, "citations should be empty");
  });

  await step("RFP requirements: bond (5%) and certification (NSF 61) meet profile", async () => {
    const doc = (await api("GET", `/api/documents/${rfpId}`)).data;
    const bond = doc.requirements.find((r: J) => r.kind === "bond" && /5\s?%/.test(r.text + r.quote));
    const nsf = doc.requirements.find((r: J) => r.kind === "certification" && /NSF/.test(r.text + r.quote));
    ok(bond?.meetsProfile === "yes", `bond: ${JSON.stringify(bond)}`);
    ok(nsf?.meetsProfile === "yes", `nsf: ${JSON.stringify(nsf)}`);
    ok(doc.keyFields.bidDue.iso === "2026-12-18" && doc.keyFields.bidDue.page === 1, "bidDue key field");
  });

  await step("start pursuit from RFP: >=8 tasks, all due <= 2026-12-18, >=1 llm task", async () => {
    const { status, data } = await api("POST", "/api/pursuits", { documentId: rfpId });
    ok(status === 201, `status ${status}: ${JSON.stringify(data)}`);
    pursuitId = data.pursuit.id;
    ok(data.tasks.length >= 8, `${data.tasks.length} tasks`);
    ok(data.tasks.every((t: J) => t.dueDate <= "2026-12-18"), "task due after 2026-12-18");
    ok(data.tasks.some((t: J) => t.source === "llm"), "no llm-source task");
    ok(data.pursuit.dueDate === "2026-12-18", `dueDate ${data.pursuit.dueDate}`);
    taskIds = data.tasks.map((t: J) => t.id);
    pursuitBefore = data;
    const again = await api("POST", "/api/pursuits", { documentId: rfpId });
    ok(again.status === 200 && again.data.pursuit.id === pursuitId, "second POST should return the existing pursuit");
  });

  await step("PATCH task done persists", async () => {
    const { status, data } = await api("PATCH", `/api/tasks/${taskIds[0]}`, { done: true });
    ok(status === 200 && data.done === true, "patch failed");
    const detail = (await api("GET", `/api/pursuits/${pursuitId}`)).data;
    ok(detail.tasks.find((t: J) => t.id === taskIds[0]).done === true, "not persisted");
    const bad = await api("PATCH", `/api/tasks/${taskIds[0]}`, { done: "yes" });
    ok(bad.status === 400 && bad.data.error, "expected 400 for invalid body");
  });

  await step("draft cover letter: 80-300 words, mentions agency and company", async () => {
    const { status, data } = await api("POST", `/api/pursuits/${pursuitId}/draft`);
    ok(status === 201, `status ${status}`);
    const words = data.text.trim().split(/\s+/).length;
    ok(words >= 80 && words <= 300, `${words} words`);
    ok(/City of Brightwater|Brightwater/.test(data.text) && /Northline Pump & Valve/.test(data.text), "missing agency/company name");
  });

  await step("addendum: >=2 changes, due_date -> 2027-01-08, pursuit and tasks move, >=2 new events", async () => {
    const before = (await api("GET", `/api/pursuits/${pursuitId}`)).data;
    const { status, data } = await api("POST", "/api/documents", {
      title: "Addendum No. 1 (smoke)",
      agencyId: brightwaterId,
      kind: "addendum",
      date: "2026-11-20",
      text: addendumText,
      parentDocumentId: rfpId,
    });
    ok(status === 201, `status ${status}: ${JSON.stringify(data)}`);
    ok(data.changes.length >= 2, `${data.changes.length} changes`);
    ok(data.changes.some((c: J) => c.field === "due_date" && c.after === "2027-01-08"), "no due_date change to 2027-01-08");
    const after = (await api("GET", `/api/pursuits/${pursuitId}`)).data;
    ok(after.pursuit.dueDate === "2027-01-08", `dueDate ${after.pursuit.dueDate}`);
    const moved = after.tasks.filter((t: J) => !t.done && before.tasks.find((b: J) => b.id === t.id).dueDate !== t.dueDate);
    ok(moved.length >= 5, `only ${moved.length} open tasks moved`);
    ok(after.tasks.find((t: J) => t.title === "Submit").dueDate === "2027-01-08", "Submit task not moved");
    ok(after.pursuit.events.length - before.pursuit.events.length >= 2, "timeline did not gain >=2 events");
    const rfp = (await api("GET", `/api/documents/${rfpId}`)).data;
    ok(rfp.addenda.length >= 1 && rfp.requirements.some((r: J) => r.documentId && r.documentId !== rfpId), "requirements not re-run with addendum");
    ok(pursuitBefore.pursuit.dueDate === "2026-12-18", "sanity");
  });

  await step("agency profile: spend by FY with non-zero total, >=1 contact", async () => {
    const { data } = await api("GET", `/api/agencies/${brightwaterId}`);
    ok(data.spend.total > 0 && data.spend.byFiscalYear.length >= 2, "no spend");
    ok(data.contacts.length >= 1, "no contacts");
    ok(data.documents.length >= 1 && data.signals.length >= 1, "no docs/signals");
  });

  await step("upload 2-page .txt (multipart) -> 2 pages, >=1 signal", async () => {
    const txt = "Page one intro. The City reviewed the annual report.\n--- page 2 ---\nThe City will begin the Oak Avenue Water Main Replacement project next spring at an estimated cost of $900,000.\n";
    const fd = new FormData();
    fd.set("title", "Smoke upload");
    fd.set("agencyId", brightwaterId);
    fd.set("kind", "minutes");
    fd.set("date", "2026-11-01");
    fd.set("file", new File([txt], "smoke.txt", { type: "text/plain" }));
    const { status, data } = await api("POST", "/api/documents", fd);
    ok(status === 201, `status ${status}: ${JSON.stringify(data)}`);
    ok(data.pages.length === 2, `${data.pages.length} pages`);
    ok(data.signals.length >= 1, "no signals");
  });

  await step("validation errors are 4xx with { error }", async () => {
    const r = await api("POST", "/api/documents", { title: "x" });
    ok(r.status === 400 && typeof r.data.error === "string", `status ${r.status}`);
    const nf = await api("GET", "/api/documents/doc_missing");
    ok(nf.status === 404, `status ${nf.status}`);
  });

  await step("HTML pages return 200", async () => {
    for (const p of ["/", "/profile", "/documents", "/documents/new", `/documents/${rfpId}`, "/pursuits", `/pursuits/${pursuitId}`, "/agencies", `/agencies/${brightwaterId}`]) {
      const res = await fetch(BASE + p);
      const html = await res.text();
      ok(res.status === 200 && /<html/i.test(html), `${p} -> ${res.status}`);
    }
  });

  console.log(failures ? `\n${failures} step(s) FAILED` : `\nAll ${n} smoke steps passed`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// End-to-end smoke test against a running server: BASE_URL (default http://localhost:$PORT or :3000).
// Re-seeds the database first (the server reads the store from disk on every request) unless SMOKE_NO_RESEED=1.
import { spawnSync } from "node:child_process";

const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
let failed = 0;

async function api(path, method = "GET", body, raw) {
  const res = await fetch(BASE + path, {
    method,
    headers: raw ? { "content-type": "text/csv" } : body ? { "content-type": "application/json" } : {},
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: res.status, json, text };
}
async function step(name, fn) {
  try { const detail = await fn(); console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`); }
  catch (e) { failed++; console.log(`FAIL  ${name} — ${e instanceof Error ? e.message : e}`); }
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }

console.log(`PostSale smoke test against ${BASE}`);

if (process.env.SMOKE_NO_RESEED !== "1") {
  await step("reseed database", () => {
    const r = spawnSync("npx", ["tsx", "scripts/seed.ts"], { encoding: "utf8", env: process.env });
    ok(r.status === 0, `seed failed: ${r.stderr || r.stdout}`);
    return r.stdout.split("\n")[0];
  });
}

let accounts = [];
await step("GET /api/health", async () => {
  const { status, json } = await api("/api/health");
  ok(status === 200 && json.ok === true, `status ${status}`);
  if (!process.env.ANTHROPIC_API_KEY) ok(json.mode === "mock", `mode is ${json.mode}`);
  return `mode=${json.mode}, accounts=${json.counts.accounts}`;
});

await step("portfolio: 8 accounts, scores 0-100, three bands", async () => {
  const { json } = await api("/api/accounts");
  accounts = json.accounts;
  ok(accounts.length === 8, `got ${accounts.length} accounts`);
  ok(accounts.every((a) => a.health && a.health.score >= 0 && a.health.score <= 100), "missing/out-of-range health");
  const bands = new Set(accounts.map((a) => a.health.band));
  ok(["green", "amber", "red"].every((b) => bands.has(b)), `bands: ${[...bands]}`);
  return accounts.map((a) => `${a.name.split(" ")[0]}=${a.health.score}`).join(" ");
});

const get360 = async (id) => (await api(`/api/accounts/${id}`)).json;
const byName = (s) => accounts.find((a) => a.name.startsWith(s));

await step("drop accounts show usage_drop with the right play and the real percentage", async () => {
  const expect = { Brightwater: "adoption_workshop", Copperline: "check_in", Fernhollow: "win_back" };
  const out = [];
  for (const [n, play] of Object.entries(expect)) {
    const v = await get360(byName(n).id);
    const a = v.openActions.find((x) => x.type === "usage_drop");
    ok(a, `${n}: no usage_drop action`);
    ok(a.play === play, `${n}: play ${a.play}, expected ${play}`);
    ok(a.rationale.includes(`${a.evidence.dropPct}%`), `${n}: rationale lacks ${a.evidence.dropPct}%`);
    out.push(`${n}=${a.evidence.dropPct}% ${a.play}`);
  }
  return out.join(", ");
});

await step("seeded actions cover every rule type", async () => {
  const { json } = await api("/api/actions?status=open");
  const types = new Set(json.actions.map((a) => a.type));
  for (const t of ["usage_drop", "renewal_prep", "onboarding_stalled", "billing_risk", "expansion"]) ok(types.has(t), `missing ${t}`);
  return `${json.actions.length} open actions`;
});

const KICKOFF = `Kickoff — Tidepool Health Data analytics rollout
Alex Moreno (PostSale, CSM): Welcome. Our goal is to get the clinical analytics dashboards live for 40 users by Jan 30.
Samir Joshi (Tidepool Health Data, VP Operations): I will send the list of pilot users by Friday.
Alex Moreno (PostSale, CSM): Jules will configure the data connector by Tuesday, and we need to schedule the training session next week.
Samir Joshi (Tidepool Health Data, VP Operations): The SSO integration is blocked because nobody owns it on our side yet.
Alex Moreno (PostSale, CSM): I will draft the data-sharing addendum for legal review.
`;
let projectTasks = [];
await step("kickoff transcript creates a project with >=3 tasks and a recap", async () => {
  const id = byName("Tidepool").id;
  const { status, json } = await api(`/api/accounts/${id}/kickoff`, "POST", { transcript: KICKOFF });
  ok(status === 201, `status ${status}: ${JSON.stringify(json)}`);
  ok(json.project.kind === "onboarding", "project kind");
  ok(json.tasks.length >= 3, `only ${json.tasks.length} tasks`);
  ok(json.recap.startsWith("Kickoff recap"), `recap starts: ${json.recap.slice(0, 30)}`);
  projectTasks = json.tasks;
  return `${json.tasks.length} tasks, ${json.blockers.length} blocker(s)`;
});

await step("PATCH task done persists", async () => {
  const t = projectTasks[0];
  const r = await api(`/api/tasks/${t.id}`, "PATCH", { done: true });
  ok(r.status === 200 && r.json.task.done === true, `status ${r.status}`);
  const v = await get360(t.accountId);
  const found = v.projects.flatMap((p) => p.tasks).find((x) => x.id === t.id);
  ok(found?.done === true, "task not done after reload");
});

await step("usage CSV with a sharp drop on the control account creates a usage_drop action and lowers the score", async () => {
  const acc = byName("Ostrander");
  const before = await get360(acc.id);
  ok(!before.openActions.some((a) => a.type === "usage_drop"), "control already has a drop action");
  const last2 = before.usage.slice(-2);
  const csv = ["week_start,active_users,metered_units,tickets_opened", ...last2.map((u) => `${u.weekStart},${u.activeUsers},2800,${u.ticketsOpened}`)].join("\n");
  const r = await api(`/api/accounts/${acc.id}/usage`, "POST", undefined, csv);
  ok(r.status === 200, `status ${r.status}: ${r.text}`);
  ok(r.json.ingested === 2, `ingested ${r.json.ingested}`);
  ok(r.json.newActions.some((a) => a.type === "usage_drop"), "no new usage_drop action");
  ok(r.json.health.score < before.account.health.score, `score ${before.account.health.score} -> ${r.json.health.score}`);
  return `score ${before.account.health.score} -> ${r.json.health.score}, play ${r.json.newActions[0].play}`;
});

await step("radar paste 'X acquires Y' creates an expansion action", async () => {
  const lum = byName("Lumenfold");
  const r = await api("/api/radar", "POST", { title: "Lumenfold Labs acquires Orbit Sketch", text: "Lumenfold Labs said it will acquire design-tools startup Orbit Sketch.", source: "smoke" });
  ok(r.status === 201, `status ${r.status}`);
  ok(r.json.signal.relevant && r.json.signal.accountIds.includes(lum.id), "not tagged to Lumenfold");
  ok(r.json.actions.some((a) => a.type === "expansion" && a.accountId === lum.id), "no expansion action");
  return `${r.json.signal.signalType}/${r.json.signal.direction}`;
});

await step("irrelevant radar paste -> relevant:false and no action", async () => {
  const r = await api("/api/radar", "POST", { title: "City council approves new bike lanes", text: "The council voted 7-2 on Tuesday to add protected bike lanes downtown.", source: "smoke" });
  ok(r.status === 201 && r.json.signal.relevant === false, "expected relevant:false");
  ok(r.json.actions.length === 0, "unexpected action");
});

await step("radar validation returns 400 with { error }", async () => {
  const r = await api("/api/radar", "POST", { title: "" });
  ok(r.status === 400 && typeof r.json.error === "string", `status ${r.status}`);
});

await step("renewal brief has all six sections and a numeric proposedArr", async () => {
  const id = byName("Marlowe").id;
  const r = await api(`/api/accounts/${id}/renewal-brief`, "POST", {});
  ok(r.status === 201, `status ${r.status}`);
  for (const h of ["Health trend", "Usage story", "Open risks", "Expansion paths", "Renewal ask", "Talking points"]) ok(r.json.brief.markdown.includes(`## ${h}`), `missing ${h}`);
  ok(typeof r.json.brief.ask.proposedArr === "number", "proposedArr not numeric");
  return `ask ${r.json.brief.ask.proposedArr} / ${r.json.brief.ask.termMonths}mo`;
});

await step("ask returns >=2 citations whose ids resolve", async () => {
  const id = byName("Copperline").id;
  const r = await api(`/api/accounts/${id}/ask`, "POST", { question: "What did Tomas say about latency and the batch API?" });
  ok(r.status === 200, `status ${r.status}`);
  ok(r.json.citations.length >= 2, `${r.json.citations.length} citations`);
  const v = await get360(id);
  const ids = new Set([v.account.id, ...v.notes.map((x) => x.id), ...v.tickets.map((x) => x.id), ...v.invoices.map((x) => x.id), ...v.signals.map((x) => x.id), ...v.briefs.map((x) => x.id), ...v.projects.flatMap((p) => p.tasks.map((t) => t.id))]);
  for (const c of r.json.citations) ok(ids.has(c.id), `citation ${c.n} id ${c.id} does not resolve`);
  return `${r.json.citations.length} citations: ${r.json.citations.map((c) => c.kind).join(",")}`;
});

await step("accept an action creates a project", async () => {
  const v = await get360(byName("Fernhollow").id);
  const a = v.openActions.find((x) => x.type === "usage_drop");
  const r = await api(`/api/actions/${a.id}`, "POST", { op: "accept" });
  ok(r.status === 200 && r.json.project?.id, "no project");
  const after = await get360(v.account.id);
  const p = after.projects.find((x) => x.id === r.json.project.id);
  ok(p && p.tasks.length >= 3, "project/tasks not found");
  ok(!after.openActions.some((x) => x.id === a.id), "action still open");
  return `${p.kind} with ${p.tasks.length} tasks`;
});

await step("snooze and dismiss remove actions from the open feed", async () => {
  const { json } = await api("/api/actions?status=open");
  const [a, b] = json.actions;
  ok((await api(`/api/actions/${a.id}`, "POST", { op: "snooze" })).json.action.status === "snoozed", "snooze");
  ok((await api(`/api/actions/${b.id}`, "POST", { op: "dismiss" })).json.action.status === "dismissed", "dismiss");
  const after = (await api("/api/actions?status=open")).json.actions;
  ok(!after.some((x) => x.id === a.id || x.id === b.id), "still listed");
});

await step("analyze twice creates no duplicate open actions", async () => {
  const a1 = await api("/api/analyze", "POST", {});
  const a2 = await api("/api/analyze", "POST", {});
  ok(a1.status === 200 && a2.status === 200, "status");
  ok(a2.json.newActions.length === 0, `second run created ${a2.json.newActions.length}`);
  const open = (await api("/api/actions?status=open")).json.actions.filter((x) => !x.dedupeKey.startsWith("signal:"));
  const keys = open.map((x) => `${x.accountId}:${x.type}`);
  ok(new Set(keys).size === keys.length, "duplicate (account,type) among open actions");
  return `first run +${a1.json.newActions.length}, second run +${a2.json.newActions.length}`;
});

const pages = ["/", `/accounts/${accounts[0]?.id}`, "/actions", "/radar", "/ask", "/projects/new"];
await step("pages return HTTP 200", async () => {
  for (const p of pages) {
    const r = await api(p);
    ok(r.status === 200 && r.text.includes("PostSale"), `${p} -> ${r.status}`);
  }
  return pages.join(" ");
});

console.log(failed ? `\n${failed} step(s) FAILED` : "\nAll steps passed");
process.exit(failed ? 1 : 0);

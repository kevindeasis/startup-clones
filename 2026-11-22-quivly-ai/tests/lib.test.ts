import { describe, expect, it } from "vitest";
import { detectActions, isDuplicate } from "../src/lib/analyze";
import { buildCtx, renewalAsk } from "../src/lib/context";
import { band, computeHealth, usageStats, WEIGHTS } from "../src/lib/health";
import { mockClassifySignal, mockPlanKickoff, tagAccounts } from "../src/lib/mock";
import { retrieve } from "../src/lib/ask";
import { parseCsv } from "../src/lib/csv";
import { parseUsageInput } from "../src/lib/usage";
import { emptyDb } from "../src/lib/store";
import type { Account, Action, DB, Invoice, Note, Ticket, UsageWeek } from "../src/lib/types";
import { addDays } from "../src/lib/util";

const NOW = "2026-11-22";
const acct: Account = {
  id: "a1", name: "Acme Test Co", aliases: ["Acme"], domain: "acme.test", segment: "SMB", plan: "Growth", arr: 100000, seats: 50,
  quotaUnitsPerWeek: 10000, contractStart: "2025-01-01", renewalDate: "2027-06-01", owner: "Sam", champion: { name: "Cy", title: "CTO", email: "cy@acme.test" }, stage: "active",
};
/** 12 complete weeks ending 2026-11-09; arrays are oldest to newest */
function usage(units: number[], users: number[], tix: number[] = units.map(() => 0)): UsageWeek[] {
  return units.map((u, i) => ({ accountId: "a1", weekStart: addDays("2026-11-09", -7 * (units.length - 1 - i)), meteredUnits: u, activeUsers: users[i], ticketsOpened: tix[i] }));
}
const flat = (n: number, v: number) => Array(n).fill(v) as number[];
const touch = (days: number): Note => ({ id: "n", accountId: "a1", at: addDays(NOW, -days), kind: "call", title: "t", body: "b" });

function dbWith(u: UsageWeek[], extra: Partial<DB> = {}): DB {
  return { ...emptyDb(), accounts: [acct], usage: u, ...extra };
}

describe("health", () => {
  it("weights sum to 1 and bands follow thresholds", () => {
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect([band(75), band(74), band(50), band(49)]).toEqual(["green", "amber", "amber", "red"]);
  });
  it("steady healthy account scores green with documented sub-scores", () => {
    const h = computeHealth({ account: acct, usage: usage(flat(12, 7000), flat(12, 35)), tickets: [], invoices: [], notes: [touch(3)], now: NOW });
    expect(h.parts.usageTrend).toBe(85);
    expect(h.parts.adoptionBreadth).toBe(100); // 35/50 = 70%
    expect(h.parts.engagementRecency).toBe(100);
    expect(h.band).toBe("green");
    expect(h.score).toBe(Math.round(85 * 0.3 + 100 * 0.2 + 100 * 0.15 + 80 * 0.15 + 100 * 0.2));
  });
  it("usage collapse, stale contact and overdue invoice lower the score", () => {
    const inv: Invoice = { id: "i", accountId: "a1", issuedAt: "2026-08-01", dueAt: addDays(NOW, -20), amount: 1, status: "overdue" };
    const good = computeHealth({ account: acct, usage: usage(flat(12, 7000), flat(12, 35)), tickets: [], invoices: [], notes: [touch(3)], now: NOW });
    const bad = computeHealth({ account: acct, usage: usage([...flat(10, 7000), 2000, 2000], flat(12, 35)), tickets: [], invoices: [inv], notes: [touch(80)], now: NOW });
    expect(bad.parts.billing).toBe(50);
    expect(bad.parts.engagementRecency).toBeLessThan(20);
    expect(bad.parts.usageTrend).toBeLessThan(good.parts.usageTrend);
    expect(bad.score).toBeLessThan(good.score - 30);
    expect(bad.why.length).toBeGreaterThan(10);
  });
  it("support load penalises tickets and open tickets", () => {
    const open: Ticket = { id: "t", accountId: "a1", openedAt: NOW, priority: "high", subject: "x" };
    const h = computeHealth({ account: acct, usage: usage(flat(12, 7000), flat(12, 35), flat(12, 1)), tickets: [open], invoices: [], notes: [], now: NOW });
    expect(h.parts.supportLoad).toBe(100 - 5 * 4 - 8);
  });
});

describe("usage-drop detector", () => {
  const run = (u: UsageWeek[], thr = 25) => detectActions(buildCtx(dbWith(u), "a1", NOW)!, NOW, thr).filter((a) => a.type === "usage_drop");
  it("computes last-2 vs prior-4 weeks", () => {
    const s = usageStats(acct, usage([...flat(10, 1000), 600, 600], flat(12, 10)), NOW);
    expect(Math.round(s.dropPct)).toBe(40);
  });
  it("fires only at or above the threshold", () => {
    expect(run(usage([...flat(10, 1000), 780, 780], flat(12, 30)))).toHaveLength(0); // 22%
    expect(run(usage([...flat(10, 1000), 740, 740], flat(12, 30)))).toHaveLength(1); // 26%
    expect(run(usage([...flat(10, 1000), 740, 740], flat(12, 30)), 30)).toHaveLength(0);
  });
  it("picks adoption_workshop when breadth fell", () => {
    const [a] = run(usage([...flat(10, 1000), 550, 550], [...flat(10, 40), 20, 20]));
    expect(a.play).toBe("adoption_workshop");
    expect(a.priority).toBe("high");
    expect(a.evidence.dropPct).toBe(45);
  });
  it("picks check_in when tickets rose, else win_back for >=60% drops", () => {
    const [b] = run(usage([...flat(10, 1000), 700, 700], flat(12, 40), [...flat(10, 0), 5, 5]));
    expect(b.play).toBe("check_in");
    expect(b.priority).toBe("medium");
    const [c] = run(usage([...flat(10, 1000), 300, 300], flat(12, 40)));
    expect(c.play).toBe("win_back");
  });
});

describe("other rules and dedupe", () => {
  it("renewal_prep within 90 days and no brief; expansion at >=90% quota", () => {
    const soon = { ...acct, renewalDate: addDays(NOW, 60) };
    const db = { ...dbWith(usage(flat(12, 9500), flat(12, 35))), accounts: [soon] };
    const types = detectActions(buildCtx(db, "a1", NOW)!, NOW, 25).map((a) => a.type);
    expect(types).toContain("renewal_prep");
    expect(types).toContain("expansion");
  });
  it("billing_risk needs >= 14 days overdue", () => {
    const mk = (d: number): Invoice => ({ id: "i", accountId: "a1", issuedAt: "2026-01-01", dueAt: addDays(NOW, -d), amount: 5, status: "overdue" });
    const t = (d: number) => detectActions(buildCtx(dbWith(usage(flat(12, 5000), flat(12, 30)), { invoices: [mk(d)] }), "a1", NOW)!, NOW).map((a) => a.type);
    expect(t(13)).not.toContain("billing_risk");
    expect(t(14)).toContain("billing_risk");
  });
  it("does not duplicate open actions of the same type", () => {
    const existing = { id: "x", accountId: "a1", type: "usage_drop", status: "open", dedupeKey: "usage_drop:a1:2026-11-02" } as Action;
    expect(isDuplicate([existing], { accountId: "a1", type: "usage_drop", dedupeKey: "usage_drop:a1:2026-11-09" }, NOW)).toBe(true);
    expect(isDuplicate([existing], { accountId: "a2", type: "usage_drop", dedupeKey: "usage_drop:a2:2026-11-09" }, NOW)).toBe(false);
    expect(isDuplicate([{ ...existing, status: "dismissed" }], { accountId: "a1", type: "usage_drop", dedupeKey: "usage_drop:a1:2026-11-09" }, NOW)).toBe(false);
  });
});

describe("mock kickoff parser", () => {
  const transcript = `Sam (Vendor, CSM): Our goal is to go live by Dec 15.
Cy (Acme Test Co, CTO): I will send the data dictionary by Friday.
Cy (Acme Test Co, CTO): SSO and SCIM are unresolved and nobody owns them yet.
Sam (Vendor, CSM): Dee will configure the sandbox workspace by Monday.
Sam (Vendor, CSM): We need to schedule the training session next week.`;
  const plan = mockPlanKickoff(transcript, acct, "2026-11-22");
  it("extracts tasks, blockers, stakeholders and a Slack-ready recap", () => {
    expect(plan.tasks.length).toBeGreaterThanOrEqual(3);
    expect(plan.blockers.length).toBeGreaterThanOrEqual(1);
    expect(plan.stakeholders.find((s) => s.name === "Cy")?.side).toBe("customer");
    expect(plan.stakeholders.find((s) => s.name === "Sam")?.side).toBe("vendor");
    expect(plan.goals[0]).toMatch(/go live/);
    expect(plan.recap.startsWith("Kickoff recap — Acme Test Co")).toBe(true);
    expect(plan.recap.split(/\s+/).length).toBeLessThanOrEqual(150);
  });
  it("resolves owners and due dates", () => {
    const send = plan.tasks.find((t) => /data dictionary/.test(t.title))!;
    expect(send.ownerName).toBe("Cy");
    expect(send.dueInDays).toBe(5); // 2026-11-22 is a Sunday, so Friday is 5 days out
    expect(plan.tasks.find((t) => /sandbox/.test(t.title))?.ownerSide).toBe("vendor"); // unknown first name falls back to the speaker (Sam, vendor)
  });
});

describe("radar classifier", () => {
  const accts = [acct, { ...acct, id: "a2", name: "Borealis Freight", aliases: ["Borealis"], domain: "borealis.test" }];
  it("tags by name, alias and domain", () => {
    expect(tagAccounts("Acme Test Co ships", accts)).toEqual(["a1"]);
    expect(tagAccounts("analysts at borealis.test said", accts)).toEqual(["a2"]);
    expect(tagAccounts("Acmeville news", accts)).toEqual([]);
  });
  it("applies keyword rules", () => {
    const c = (t: string) => mockClassifySignal({ title: t, text: "" }, accts);
    expect(c("Acme acquires Orbit Labs")).toMatchObject({ signalType: "acquisition", direction: "expansion", suggestedPlay: "expansion_project", relevant: true });
    expect(c("Borealis raises $50M Series B")).toMatchObject({ signalType: "funding", direction: "expansion" });
    expect(c("Acme announces layoffs")).toMatchObject({ signalType: "layoffs", direction: "risk", suggestedPlay: "exec_check_in" });
    expect(c("Acme appoints new CTO")).toMatchObject({ signalType: "leadership_change", direction: "neutral" });
    expect(c("Acme posts 12 engineering roles")).toMatchObject({ signalType: "hiring", direction: "expansion" });
    expect(c("Unknown Corp acquires Other Inc")).toMatchObject({ relevant: false, accountIds: [] });
  });
});

describe("renewal ask rule", () => {
  it("uplifts at >=90% quota, flat on poor health, small uplift when green", () => {
    expect(renewalAsk(100000, 80, 95)).toMatchObject({ proposedArr: 115000, termMonths: 24 });
    expect(renewalAsk(100000, 40, 95).proposedArr).toBe(100000); // health wins
    expect(renewalAsk(100000, 80, 60).proposedArr).toBe(105000);
    const amber = renewalAsk(100000, 60, 60);
    expect(amber.proposedArr).toBe(100000);
    expect(amber.justification).toMatch(/amber/);
  });
});

describe("csv and retrieval", () => {
  it("parses usage CSV and JSON", () => {
    const csv = "week_start,active_users,metered_units,tickets_opened\n2026-11-09,30,6500,1\n2026-11-02,31,6600,0\n";
    expect(parseCsv(csv)).toHaveLength(2);
    const r = parseUsageInput(csv, "text/csv");
    expect("rows" in r && r.rows[0]).toMatchObject({ week_start: "2026-11-09", metered_units: 6500 });
    const j = parseUsageInput(JSON.stringify([{ week_start: "2026-11-09", active_users: 1, metered_units: 2 }]), "application/json");
    expect("rows" in j && j.rows[0].tickets_opened).toBe(0);
    expect("error" in parseUsageInput("nonsense", "text/csv")).toBe(true);
  });
  it("retrieves relevant sources with numbered ids", () => {
    const notes: Note[] = [
      { id: "n1", accountId: "a1", at: "2026-10-01", kind: "email", title: "Latency complaint", body: "The batch API is timing out for the platform team." },
      { id: "n2", accountId: "a1", at: "2026-10-02", kind: "call", title: "Roadmap", body: "Discussed the dashboard roadmap." },
    ];
    const ctx = buildCtx(dbWith(usage(flat(12, 5000), flat(12, 30)), { notes }), "a1", NOW)!;
    const src = retrieve(ctx, "why is the batch API timing out?");
    expect(src[0]).toMatchObject({ n: 1, kind: "note", id: "n1" });
    expect(src.length).toBeGreaterThanOrEqual(3);
    expect(src.map((s) => s.n)).toEqual(src.map((_, i) => i + 1));
  });
});

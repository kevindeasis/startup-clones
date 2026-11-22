import type { Action } from "./types";
import { buildCtx, type AccountCtx } from "./context";
import { computeHealth, overdueDays } from "./health";
import { explainAction } from "./llm";
import { mutate, newId, readDb } from "./store";
import { daysBetween, today } from "./util";

export type Candidate = Pick<Action, "accountId" | "type" | "priority" | "title" | "play" | "evidence" | "dedupeKey">;

const PLAY_LABEL: Record<string, string> = {
  adoption_workshop: "run an adoption workshop", check_in: "schedule a check-in", win_back: "start a win-back project",
};

export function thresholdPct(): number {
  const n = Number(process.env.USAGE_DROP_THRESHOLD_PCT);
  return Number.isFinite(n) && n > 0 ? n : 25;
}

/** Pure rule engine: usage-drop detector + renewal / onboarding / billing / quota-expansion rules. */
export function detectActions(ctx: AccountCtx, now = today(), threshold = thresholdPct()): Candidate[] {
  const out: Candidate[] = [];
  const a = ctx.account;
  if (a.stage === "churned") return out;
  const s = ctx.stats;
  const r = Math.round;

  if (s.enough && s.dropPct >= threshold) {
    const breadthFell = s.breadthRecent < s.breadthPrior * 0.85;
    const ticketsRose = s.ticketsRecent >= Math.max(s.ticketsPrior * 1.5, s.ticketsPrior + 1);
    const play = breadthFell ? "adoption_workshop" : ticketsRose ? "check_in" : s.dropPct >= 60 ? "win_back" : "check_in";
    out.push({
      accountId: a.id, type: "usage_drop", priority: s.dropPct >= 40 ? "high" : "medium", play,
      title: `Usage down ${r(s.dropPct)}% — ${PLAY_LABEL[play]}`,
      evidence: {
        dropPct: r(s.dropPct), recentAvg: r(s.recentAvg), priorAvg: r(s.priorAvg),
        breadthRecentPct: r(s.breadthRecent * 100), breadthPriorPct: r(s.breadthPrior * 100),
        ticketsRecent: Number(s.ticketsRecent.toFixed(1)), ticketsPrior: Number(s.ticketsPrior.toFixed(1)), weekStart: s.weekStart,
      },
      dedupeKey: `usage_drop:${a.id}:${s.weekStart}`,
    });
  }

  if (ctx.daysToRenewal >= 0 && ctx.daysToRenewal <= 90 && ctx.briefs.length === 0) {
    out.push({
      accountId: a.id, type: "renewal_prep", priority: ctx.daysToRenewal <= 30 ? "high" : "medium", play: "renewal_prep",
      title: `Renewal in ${ctx.daysToRenewal} days — prepare the renewal brief`,
      evidence: { renewalDate: a.renewalDate, daysToRenewal: ctx.daysToRenewal, health: a.health?.score ?? "n/a" },
      dedupeKey: `renewal_prep:${a.id}:${a.renewalDate}`,
    });
  }

  for (const p of ctx.projects.filter((p) => p.kind === "onboarding" && p.status === "active")) {
    const late = p.tasks.filter((t) => t.isBlocker && !t.done && daysBetween(t.dueAt, now) >= 7)
      .sort((x, y) => x.dueAt.localeCompare(y.dueAt))[0];
    if (late) {
      out.push({
        accountId: a.id, type: "onboarding_stalled", priority: "high", play: "unblock",
        title: `Onboarding stalled — blocker ${daysBetween(late.dueAt, now)} days overdue`,
        evidence: { task: late.title, taskId: late.id, daysOverdue: daysBetween(late.dueAt, now), projectId: p.id },
        dedupeKey: `onboarding_stalled:${a.id}:${late.id}`,
      });
    }
  }

  for (const inv of ctx.invoices) {
    const d = overdueDays(inv, now);
    if (d >= 14) {
      out.push({
        accountId: a.id, type: "billing_risk", priority: d >= 30 ? "high" : "medium", play: "collections",
        title: `Invoice ${inv.id} is ${d} days overdue`,
        evidence: { invoiceId: inv.id, amount: inv.amount, daysOverdue: d },
        dedupeKey: `billing_risk:${a.id}:${inv.id}`,
      });
    }
  }

  if (ctx.weeksNearQuota >= 3) {
    out.push({
      accountId: a.id, type: "expansion", priority: "medium", play: "expansion_project",
      title: `At ${ctx.quotaPct}% of plan quota — open an expansion`,
      evidence: { weeksNearQuota: ctx.weeksNearQuota, quotaPct: ctx.quotaPct },
      dedupeKey: `expansion:${a.id}:quota:${s.weekStart}`,
    });
  }
  return out;
}

/** True if a matching action already exists (same key, or an open/snoozed one of the same kind). */
export function isDuplicate(existing: Action[], c: Pick<Action, "accountId" | "type" | "dedupeKey">, now = today()): boolean {
  return existing.some((x) => {
    if (x.dedupeKey === c.dedupeKey) return true;
    const live = x.status === "open" || (x.status === "snoozed" && (x.snoozedUntil ?? "") > now);
    const signalBased = x.dedupeKey.startsWith("signal:") || c.dedupeKey.startsWith("signal:");
    const quota = x.dedupeKey.includes(":quota:") !== c.dedupeKey.includes(":quota:");
    return live && !signalBased && !quota && x.accountId === c.accountId && x.type === c.type;
  });
}

export async function buildAction(c: Candidate, ctx: AccountCtx): Promise<Action> {
  const ex = await explainAction(c, { account: ctx.account });
  return {
    id: newId("act"), ...c, rationale: ex.rationale, nextSteps: ex.nextSteps.slice(0, 3),
    status: "open", createdAt: new Date().toISOString(), ...(ex.degraded ? { degraded: true } : {}),
  };
}

/** Recompute health for the account(s), detect actions, write them (idempotent). */
export async function analyze(accountId?: string): Promise<{ analyzed: number; newActions: Action[] }> {
  const db = readDb();
  const now = today();
  const targets = db.accounts.filter((a) => !accountId || a.id === accountId);
  const planned: { id: string; health: ReturnType<typeof computeHealth>; built: Action[] }[] = [];

  for (const acc of targets) {
    const ctx = buildCtx(db, acc.id, now)!;
    const health = computeHealth({ account: acc, usage: ctx.usage, tickets: ctx.tickets, invoices: ctx.invoices, notes: ctx.notes, now });
    ctx.account = { ...acc, health };
    const cands = detectActions(ctx, now).filter((c) => !isDuplicate(db.actions, c, now));
    planned.push({ id: acc.id, health, built: await Promise.all(cands.map((c) => buildAction(c, ctx))) });
  }

  return mutate((d) => {
    const created: Action[] = [];
    for (const x of d.actions) if (x.status === "snoozed" && (x.snoozedUntil ?? "") <= now) { x.status = "open"; delete x.snoozedUntil; }
    for (const p of planned) {
      const acc = d.accounts.find((a) => a.id === p.id);
      if (!acc) continue;
      acc.health = p.health;
      const last = d.snapshots.filter((s) => s.accountId === acc.id).at(-1);
      if (last && last.at === now) last.score = p.health.score;
      else d.snapshots.push({ accountId: acc.id, at: now, score: p.health.score });
      for (const a of p.built) if (!isDuplicate(d.actions, a, now)) { d.actions.push(a); created.push(a); }
    }
    return { analyzed: planned.length, newActions: created };
  });
}


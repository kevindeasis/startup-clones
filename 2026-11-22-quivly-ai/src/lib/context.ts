import type { Account, Action, Brief, DB, HealthSnapshot, Invoice, Note, Project, Signal, Task, Ticket, UsageWeek } from "./types";
import { completeWeeks, usageStats, type UsageStats } from "./health";
import { daysBetween, today } from "./util";

export type ProjectWithTasks = Project & { tasks: Task[] };

export interface AccountCtx {
  account: Account;
  usage: UsageWeek[];
  stats: UsageStats;
  tickets: Ticket[];
  invoices: Invoice[];
  notes: Note[];
  signals: Signal[];
  projects: ProjectWithTasks[];
  actions: Action[];
  briefs: Brief[];
  snapshots: HealthSnapshot[];
  quotaPct: number; // latest complete week units as % of quota
  weeksNearQuota: number; // of last 4 complete weeks with usage >= 90% of quota
  daysToRenewal: number;
}

export function buildCtx(db: DB, accountId: string, now = today()): AccountCtx | undefined {
  const account = db.accounts.find((a) => a.id === accountId);
  if (!account) return undefined;
  const usage = db.usage.filter((u) => u.accountId === accountId).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  const done = completeWeeks(usage, now);
  const quota = Math.max(1, account.quotaUnitsPerWeek);
  return {
    account,
    usage,
    stats: usageStats(account, usage, now),
    tickets: db.tickets.filter((t) => t.accountId === accountId),
    invoices: db.invoices.filter((t) => t.accountId === accountId),
    notes: db.notes.filter((t) => t.accountId === accountId),
    signals: db.signals.filter((s) => s.relevant && s.accountIds.includes(accountId)),
    projects: db.projects.filter((p) => p.accountId === accountId)
      .map((p) => ({ ...p, tasks: db.tasks.filter((t) => t.projectId === p.id) })),
    actions: db.actions.filter((a) => a.accountId === accountId),
    briefs: db.briefs.filter((b) => b.accountId === accountId),
    snapshots: db.snapshots.filter((s) => s.accountId === accountId),
    quotaPct: Math.round(((done.at(-1)?.meteredUnits ?? 0) / quota) * 100),
    weeksNearQuota: done.slice(-4).filter((u) => u.meteredUnits >= 0.9 * quota).length,
    daysToRenewal: daysBetween(now, account.renewalDate),
  };
}

export interface RenewalAsk {
  proposedArr: number;
  termMonths: number;
  justification: string;
}

/** Renewal-ask rule (deterministic): uplift on quota pressure, flat + success plan on poor health. */
export function renewalAsk(arr: number, healthScore: number, quotaPct: number): RenewalAsk {
  if (healthScore < 50) {
    return { proposedArr: arr, termMonths: 12, justification: `Health is ${healthScore} (<50), so propose a flat renewal at ${arr} tied to a joint success plan before any uplift.` };
  }
  if (quotaPct >= 90) {
    return { proposedArr: Math.round(arr * 1.15), termMonths: 24, justification: `Usage is ${quotaPct}% of plan quota (>=90%), so propose a 15% uplift on a 24-month term to cover the headroom they need.` };
  }
  if (healthScore >= 75) {
    return { proposedArr: Math.round(arr * 1.05), termMonths: 24, justification: `Health is ${healthScore} (green) with usage at ${quotaPct}% of quota, so propose a 5% uplift for a 24-month term.` };
  }
  return { proposedArr: arr, termMonths: 12, justification: `Health is ${healthScore} (amber), so propose a flat 12-month renewal and revisit the uplift after usage recovers.` };
}

export interface Source {
  n: number;
  kind: "note" | "ticket" | "invoice" | "signal" | "task" | "brief" | "metrics";
  id: string;
  title: string;
  text: string;
}

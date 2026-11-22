import type { Account, Band, Health, HealthParts, Invoice, Note, Ticket, UsageWeek } from "./types";
import { addDays, clamp, daysBetween, mean, today } from "./util";

export const WEIGHTS = {
  usageTrend: 0.3,
  adoptionBreadth: 0.2,
  supportLoad: 0.15,
  billing: 0.15,
  engagementRecency: 0.2,
} as const;

export function band(score: number): Band {
  return score >= 75 ? "green" : score >= 50 ? "amber" : "red";
}

/** Weeks whose Monday + 7 days <= now, oldest first. */
export function completeWeeks(usage: UsageWeek[], now = today()): UsageWeek[] {
  return usage
    .filter((u) => addDays(u.weekStart, 7) <= addDays(now, 1))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

export interface UsageStats {
  recentAvg: number;
  priorAvg: number;
  dropPct: number; // positive = decline
  ratio: number;
  breadthRecent: number; // active users / seats, 0..1
  breadthPrior: number;
  ticketsRecent: number; // mean per week
  ticketsPrior: number;
  weekStart: string; // latest complete week
  enough: boolean;
}

/** last 2 complete weeks versus the prior 4 weeks */
export function usageStats(account: Account, usage: UsageWeek[], now = today()): UsageStats {
  const w = completeWeeks(usage, now);
  const recent = w.slice(-2);
  const prior = w.slice(-6, -2);
  const recentAvg = mean(recent.map((x) => x.meteredUnits));
  const priorAvg = mean(prior.map((x) => x.meteredUnits));
  const ratio = priorAvg > 0 ? recentAvg / priorAvg : 1;
  return {
    recentAvg, priorAvg, ratio,
    dropPct: priorAvg > 0 ? ((priorAvg - recentAvg) / priorAvg) * 100 : 0,
    breadthRecent: mean(recent.map((x) => x.activeUsers)) / Math.max(1, account.seats),
    breadthPrior: mean(prior.map((x) => x.activeUsers)) / Math.max(1, account.seats),
    ticketsRecent: mean(recent.map((x) => x.ticketsOpened)),
    ticketsPrior: mean(prior.map((x) => x.ticketsOpened)),
    weekStart: w.at(-1)?.weekStart ?? "",
    enough: recent.length === 2 && prior.length >= 3,
  };
}

/** Days an invoice is past due (0 if paid or not yet due). */
export function overdueDays(inv: Invoice, now = today()): number {
  if (inv.paidAt) return 0;
  return Math.max(0, daysBetween(inv.dueAt, now));
}

export interface HealthInput {
  account: Account;
  usage: UsageWeek[];
  tickets: Ticket[];
  invoices: Invoice[];
  notes: Note[];
  now?: string;
}

/**
 * Health score = 30% usageTrend + 20% adoptionBreadth + 15% supportLoad + 15% billing + 20% engagementRecency.
 *  usageTrend        = clamp(85 + (ratio - 1) * 150)       ratio = mean(last 2 wks units) / mean(prior 4 wks units)
 *  adoptionBreadth   = clamp(activeUsers(last 2 wks avg) / seats / 0.70 * 100)   (70% of seats active = 100)
 *  supportLoad       = clamp(100 - 5 * tickets opened in last 4 wks - 8 * currently open tickets)
 *  billing           = clamp(100 - 5 * unpaid-not-due invoices - (30 + min(days overdue, 40)) * overdue invoices); no invoices = 80
 *  engagementRecency = 100 if last human touch <= 14 days ago, then -100/76 per day (0 at 90 days)
 */
export function computeHealth(input: HealthInput): Health {
  const { account, usage, tickets, invoices, notes } = input;
  const now = input.now ?? today();
  const s = usageStats(account, usage, now);
  const wk = completeWeeks(usage, now);

  const usageTrend = s.enough ? clamp(85 + (s.ratio - 1) * 150) : 60;
  const adoptionBreadth = clamp((s.breadthRecent / 0.7) * 100);
  const tickets4w = wk.slice(-4).reduce((a, x) => a + x.ticketsOpened, 0);
  const openTickets = tickets.filter((t) => !t.closedAt).length;
  const supportLoad = clamp(100 - 5 * tickets4w - 8 * openTickets);

  const overdue = invoices.filter((i) => overdueDays(i, now) > 0);
  const openNotDue = invoices.filter((i) => !i.paidAt && overdueDays(i, now) === 0);
  const maxOverdue = Math.max(0, ...overdue.map((i) => overdueDays(i, now)));
  const billing = invoices.length === 0 ? 80
    : clamp(100 - 5 * openNotDue.length - overdue.length * (30 + Math.min(maxOverdue, 40)));

  const touches = notes.filter((n) => n.kind !== "slack-draft").map((n) => n.at).sort();
  const lastTouch = touches.at(-1);
  const daysSince = lastTouch ? Math.max(0, daysBetween(lastTouch, now)) : 999;
  const engagementRecency = clamp(100 - Math.max(0, daysSince - 14) * (100 / 76));

  const parts: HealthParts = {
    usageTrend: Math.round(usageTrend),
    adoptionBreadth: Math.round(adoptionBreadth),
    supportLoad: Math.round(supportLoad),
    billing: Math.round(billing),
    engagementRecency: Math.round(engagementRecency),
  };
  const score = Math.round(
    parts.usageTrend * WEIGHTS.usageTrend + parts.adoptionBreadth * WEIGHTS.adoptionBreadth +
    parts.supportLoad * WEIGHTS.supportLoad + parts.billing * WEIGHTS.billing +
    parts.engagementRecency * WEIGHTS.engagementRecency,
  );
  const inputs = {
    recentAvgUnits: Math.round(s.recentAvg), priorAvgUnits: Math.round(s.priorAvg),
    usageChangePct: Math.round((s.ratio - 1) * 100),
    seatsActivePct: Math.round(s.breadthRecent * 100),
    tickets4w, openTickets,
    overdueInvoices: overdue.length, maxDaysOverdue: maxOverdue,
    daysSinceContact: daysSince === 999 ? "never" : daysSince,
  };
  return { score, band: band(score), parts, inputs, computedAt: new Date().toISOString(), why: explainHealth(score, parts, inputs) };
}

const LABEL: Record<keyof HealthParts, string> = {
  usageTrend: "usage trend", adoptionBreadth: "seat adoption", supportLoad: "support load",
  billing: "billing", engagementRecency: "engagement recency",
};

function explainHealth(score: number, parts: HealthParts, inputs: Record<string, number | string>): string {
  const sorted = (Object.keys(parts) as (keyof HealthParts)[]).sort((a, b) => parts[a] - parts[b]);
  const worst = sorted[0];
  const best = sorted[sorted.length - 1];
  const detail: Record<keyof HealthParts, string> = {
    usageTrend: `usage ${Number(inputs.usageChangePct) >= 0 ? "+" : ""}${inputs.usageChangePct}% vs prior 4 weeks`,
    adoptionBreadth: `${inputs.seatsActivePct}% of seats active`,
    supportLoad: `${inputs.tickets4w} tickets in 4 weeks, ${inputs.openTickets} open`,
    billing: inputs.overdueInvoices ? `${inputs.overdueInvoices} overdue invoice(s), up to ${inputs.maxDaysOverdue}d late` : "invoices current",
    engagementRecency: `last contact ${inputs.daysSinceContact} days ago`,
  };
  if (parts[worst] >= 75) return `Strong across the board (${score}); weakest area is ${LABEL[worst]} (${detail[worst]}).`;
  return `Held back by ${LABEL[worst]} (${parts[worst]}: ${detail[worst]}); strongest is ${LABEL[best]} (${parts[best]}).`;
}

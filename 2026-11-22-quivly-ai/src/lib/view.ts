import type { DB } from "./types";
import { buildCtx } from "./context";
import { today } from "./util";

/** Full Customer 360 payload (also used by the account page). */
export function get360(db: DB, id: string) {
  const ctx = buildCtx(db, id);
  if (!ctx) return undefined;
  const timeline = [
    ...ctx.notes.map((n) => ({ at: n.at, kind: n.kind as string, id: n.id, title: n.title, body: n.body })),
    ...ctx.tickets.map((t) => ({ at: t.openedAt, kind: "ticket", id: t.id, title: `Ticket (${t.priority}): ${t.subject}`, body: t.closedAt ? `Closed ${t.closedAt}` : "Open" })),
    ...ctx.invoices.map((i) => ({ at: i.issuedAt, kind: "invoice", id: i.id, title: `Invoice ${i.id}: $${i.amount.toLocaleString("en-US")}`, body: i.paidAt ? `Paid ${i.paidAt}` : `Due ${i.dueAt}${i.dueAt < today() ? " (overdue)" : ""}` })),
    ...ctx.signals.map((s) => ({ at: s.publishedAt, kind: "signal", id: s.id, title: s.title, body: s.summary })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return {
    account: ctx.account, usage: ctx.usage, stats: ctx.stats, quotaPct: ctx.quotaPct, daysToRenewal: ctx.daysToRenewal,
    tickets: ctx.tickets, invoices: ctx.invoices, notes: ctx.notes, signals: ctx.signals, projects: ctx.projects,
    actions: ctx.actions, openActions: ctx.actions.filter((a) => a.status === "open"), briefs: ctx.briefs,
    snapshots: ctx.snapshots, timeline,
  };
}

import MiniSearch from "minisearch";
import type { AccountCtx, Source } from "./context";
import { answerQuestion } from "./llm";
import { money, today } from "./util";

type Doc = Omit<Source, "n">;

export function metricsCard(ctx: AccountCtx): string {
  const a = ctx.account;
  const h = a.health;
  const s = ctx.stats;
  return [
    `${a.name} (${a.segment}, plan ${a.plan}) ARR ${money(a.arr)}, ${a.seats} seats, renewal ${a.renewalDate} in ${ctx.daysToRenewal} days.`,
    h ? `Health ${h.score} (${h.band}): ${h.why}` : "",
    `Usage: last 2 weeks avg ${Math.round(s.recentAvg)} units vs prior 4 weeks ${Math.round(s.priorAvg)} (${Math.round(-s.dropPct)}% change); ${ctx.quotaPct}% of weekly quota; ${Math.round(s.breadthRecent * 100)}% of seats active.`,
    `Open tickets: ${ctx.tickets.filter((t) => !t.closedAt).length}. Overdue invoices: ${ctx.invoices.filter((i) => !i.paidAt && i.dueAt < today()).length}.`,
  ].filter(Boolean).join(" ");
}

export function buildDocs(ctx: AccountCtx): Doc[] {
  const docs: Doc[] = [{ kind: "metrics", id: ctx.account.id, title: "Metrics card", text: metricsCard(ctx) }];
  for (const n of ctx.notes) docs.push({ kind: "note", id: n.id, title: `${n.kind}: ${n.title} (${n.at})`, text: n.body });
  for (const t of ctx.tickets) docs.push({ kind: "ticket", id: t.id, title: `Ticket ${t.priority}: ${t.subject}`, text: `${t.subject}. Opened ${t.openedAt}${t.closedAt ? `, closed ${t.closedAt}` : ", still open"}.` });
  for (const i of ctx.invoices) docs.push({ kind: "invoice", id: i.id, title: `Invoice ${i.id}`, text: `Invoice ${i.id} for ${money(i.amount)} issued ${i.issuedAt}, due ${i.dueAt}, ${i.paidAt ? `paid ${i.paidAt}` : "unpaid"}.` });
  for (const s of ctx.signals) docs.push({ kind: "signal", id: s.id, title: `Signal: ${s.title}`, text: `${s.summary} ${s.text}` });
  for (const p of ctx.projects) for (const t of p.tasks) docs.push({ kind: "task", id: t.id, title: `Task: ${t.title}`, text: `${t.title}. Project ${p.title}. Owner ${t.ownerName ?? t.ownerSide}, due ${t.dueAt}, ${t.done ? "done" : "open"}${t.isBlocker ? ", blocker" : ""}.` });
  for (const b of ctx.briefs) docs.push({ kind: "brief", id: b.id, title: `Renewal brief ${b.createdAt.slice(0, 10)}`, text: b.markdown });
  return docs;
}

const STOP = new Set("the a an of to is are was were why what how did do does for on in at and or with this that it its has have had can".split(" "));

export function retrieve(ctx: AccountCtx, question: string, k = 8): Source[] {
  const docs = buildDocs(ctx).map((d, i) => ({ ...d, key: String(i) }));
  const ms = new MiniSearch<(typeof docs)[number]>({
    fields: ["title", "text"], storeFields: ["key"], idField: "key",
    searchOptions: { prefix: true, fuzzy: 0.2, boost: { title: 2 }, combineWith: "OR" },
  });
  ms.addAll(docs);
  const q = question.toLowerCase().split(/\W+/).filter((w) => w && !STOP.has(w)).join(" ");
  const hits = q ? ms.search(q).slice(0, k).map((h) => docs[Number(h.id)]) : [];
  const picked = new Map(hits.map((d) => [`${d.kind}:${d.id}`, d]));
  // pad with the metrics card and the newest notes so there are always a few sources
  for (const d of [docs[0], ...docs.filter((x) => x.kind === "note").slice(-3).reverse()]) {
    if (picked.size >= Math.max(3, Math.min(k, hits.length))) break;
    picked.set(`${d.kind}:${d.id}`, d);
  }
  return [...picked.values()].slice(0, k).map((d, i) => ({ n: i + 1, kind: d.kind, id: d.id, title: d.title, text: d.text }));
}

export async function ask(ctx: AccountCtx, question: string) {
  const sources = retrieve(ctx, question);
  const res = await answerQuestion(question, sources, ctx.account);
  const cited = new Set([...res.answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));
  const chosen = sources.filter((s) => cited.has(s.n));
  const citations = (chosen.length ? chosen : sources.slice(0, 3)).map((s) => ({
    n: s.n, kind: s.kind, id: s.id, title: s.title, excerpt: s.text.replace(/\s+/g, " ").slice(0, 200),
  }));
  return { answer: res.answer, citations, ...(res.degraded ? { degraded: true } : {}) };
}

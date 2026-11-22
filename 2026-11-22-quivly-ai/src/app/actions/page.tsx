import { readDb } from "@/lib/store";
import { ActionCard } from "@/components/ActionCard";
import type { ActionType } from "@/lib/types";

export const dynamic = "force-dynamic";
const TYPES: ActionType[] = ["usage_drop", "renewal_prep", "onboarding_stalled", "billing_risk", "expansion", "risk"];
const RANK = { high: 0, medium: 1, low: 2 };

export default async function ActionsPage({ searchParams }: { searchParams: Promise<{ type?: string; priority?: string; account?: string }> }) {
  const q = await searchParams;
  const db = readDb();
  const name = new Map(db.accounts.map((a) => [a.id, a.name]));
  const list = db.actions
    .filter((a) => a.status === "open" && (!q.type || a.type === q.type) && (!q.priority || a.priority === q.priority) && (!q.account || a.accountId === q.account))
    .sort((a, b) => RANK[a.priority] - RANK[b.priority] || b.createdAt.localeCompare(a.createdAt));
  return (
    <>
      <h1>Actions feed</h1>
      <p className="muted">Open recommendations across all accounts. Numbers are computed by code; the model only phrases them.</p>
      <form className="filters" method="get">
        <div><label htmlFor="ft">Type</label><select id="ft" name="type" defaultValue={q.type ?? ""}><option value="">All</option>{TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}</select></div>
        <div><label htmlFor="fp">Priority</label><select id="fp" name="priority" defaultValue={q.priority ?? ""}><option value="">All</option><option>high</option><option>medium</option><option>low</option></select></div>
        <div><label htmlFor="fa">Account</label><select id="fa" name="account" defaultValue={q.account ?? ""}><option value="">All</option>{db.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
        <button>Filter</button>
      </form>
      <p className="small muted">{list.length} open action(s)</p>
      {list.map((a) => <ActionCard key={a.id} a={a} accountName={name.get(a.accountId)} />)}
      {list.length === 0 && <div className="card">Nothing to do. Run <code>npm run analyze</code> or ingest usage data.</div>}
    </>
  );
}

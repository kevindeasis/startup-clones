import Link from "next/link";
import { readDb } from "@/lib/store";
import { RadarForm } from "@/components/client";

export const dynamic = "force-dynamic";
const TYPES = ["acquisition", "funding", "leadership_change", "hiring", "layoffs", "outage", "competitor", "other"];

export default async function RadarPage({ searchParams }: { searchParams: Promise<{ direction?: string; type?: string; account?: string; all?: string }> }) {
  const q = await searchParams;
  const db = readDb();
  const name = new Map(db.accounts.map((a) => [a.id, a.name]));
  const list = db.signals
    .filter((s) => (q.all === "1" || s.relevant) && (!q.direction || s.direction === q.direction) && (!q.type || s.signalType === q.type) && (!q.account || s.accountIds.includes(q.account)))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return (
    <>
      <h1>Radar</h1>
      <p className="muted">External signals (funding, acquisitions, hiring, layoffs…) matched to your accounts.</p>
      <form className="filters" method="get">
        <div><label htmlFor="rd">Direction</label><select id="rd" name="direction" defaultValue={q.direction ?? ""}><option value="">All</option><option>expansion</option><option>risk</option><option>neutral</option></select></div>
        <div><label htmlFor="rtp">Type</label><select id="rtp" name="type" defaultValue={q.type ?? ""}><option value="">All</option>{TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}</select></div>
        <div><label htmlFor="ra">Account</label><select id="ra" name="account" defaultValue={q.account ?? ""}><option value="">All</option>{db.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" name="all" value="1" defaultChecked={q.all === "1"} /> show filtered-out</label>
        <button>Filter</button>
      </form>
      {list.map((s) => (
        <div className="card" key={s.id} id={`item-${s.id}`} style={s.relevant ? undefined : { opacity: 0.65 }}>
          <div className="row">
            <span className={`badge ${s.direction === "risk" ? "high" : s.direction === "expansion" ? "green" : ""}`}>{s.direction}</span>
            <span className="badge">{s.signalType.replace(/_/g, " ")}</span>
            {!s.relevant && <span className="badge">filtered out</span>}
            <span className="muted small">{s.publishedAt} · {s.source}</span>
          </div>
          <h3 style={{ marginTop: 6 }}>{s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a> : s.title}</h3>
          <p>{s.summary}</p>
          <p className="small muted">{s.accountIds.length ? <>Accounts: {s.accountIds.map((id) => <Link key={id} href={`/accounts/${id}`}>{name.get(id)} </Link>)}</> : "No tracked account"} · suggested play: {s.suggestedPlay.replace(/_/g, " ")}</p>
        </div>
      ))}
      {list.length === 0 && <div className="card">No signals match.</div>}
      <div className="card"><h2>Paste an article</h2><RadarForm /></div>
    </>
  );
}

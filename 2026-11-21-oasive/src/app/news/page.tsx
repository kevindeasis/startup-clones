import Link from "next/link";
import { SeverityBadge, TypeBadge } from "@/components/Badges";
import { NewsIngestForm } from "@/components/NewsIngestForm";
import { fmtUsd, TYPE_LABEL } from "@/lib/format";
import { ensureDefaultWatchlist, HttpError, newsFeed } from "@/lib/service";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function NewsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const f = {
    obligorId: one(sp.obligorId), type: one(sp.type), severity: one(sp.severity), watchlistId: one(sp.watchlistId),
    includeFiltered: ["1", "true", "on"].includes(one(sp.includeFiltered) ?? ""),
  };
  const [obligors, lists] = await Promise.all([store.listObligors(), ensureDefaultWatchlist()]);
  const names = new Map(obligors.map((o) => [o.id, o.name]));
  let items: Awaited<ReturnType<typeof newsFeed>>;
  let err = "";
  try {
    items = await newsFeed(f);
  } catch (e) {
    if (!(e instanceof HttpError)) throw e;
    err = e.message;
    items = [];
  }
  return (
    <>
      <div>
        <h1>News monitoring</h1>
        <p className="muted">Credit-relevant local news tagged to obligors. Non-relevant items are kept but hidden by default.</p>
      </div>
      <form className="panel filters" method="GET" action="/news" aria-label="News filters">
        <label>
          Obligor
          <select name="obligorId" defaultValue={f.obligorId ?? ""}>
            <option value="">All</option>
            {obligors.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </label>
        <label>
          Event type
          <select name="type" defaultValue={f.type ?? ""}>
            <option value="">All</option>
            {Object.entries(TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Severity
          <select name="severity" defaultValue={f.severity ?? ""}>
            <option value="">All</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
        <label>
          Watchlist
          <select name="watchlistId" defaultValue={f.watchlistId ?? ""}>
            <option value="">All</option>
            {lists.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" name="includeFiltered" value="1" defaultChecked={f.includeFiltered} /> Show filtered
        </label>
        <div className="row">
          <button type="submit">Apply</button>
          <Link href="/news">Reset</Link>
        </div>
      </form>
      <NewsIngestForm />
      {err && <div className="error">{err}</div>}
      <section className="panel stack" aria-label="News feed">
        <h2>{items.length} item(s)</h2>
        {items.length === 0 ? (
          <p className="muted">Nothing matches these filters.</p>
        ) : (
          <ul className="events">
            {items.map((n) => (
              <li key={n.id} data-testid="news-item">
                <div className="row wrap">
                  {n.creditRelevant ? (
                    <>
                      <SeverityBadge s={n.severity} />
                      <TypeBadge t={n.eventType} />
                    </>
                  ) : (
                    <span className="badge">filtered</span>
                  )}
                  <span className="muted">{n.publishedAt.slice(0, 10)}</span>
                  <span className="muted">{n.source}</span>
                  {n.dollarAmounts[0] != null && <span className="badge">{fmtUsd(n.dollarAmounts[0])}</span>}
                </div>
                <div>
                  <strong>{n.title}</strong>
                </div>
                <div className="muted">{n.summary}</div>
                <div className="row wrap">
                  {n.obligorIds.map((id) => (
                    <Link key={id} href={`/obligors/${id}`} className="badge type">
                      {names.get(id) ?? id}
                    </Link>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

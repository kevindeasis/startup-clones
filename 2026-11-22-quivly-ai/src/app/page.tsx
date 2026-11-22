import Link from "next/link";
import { buildCtx } from "@/lib/context";
import { readDb } from "@/lib/store";
import { Delta, HealthBadge, Sparkline } from "@/components/ui";
import { money } from "@/lib/util";

export const dynamic = "force-dynamic";

export default async function Portfolio({ searchParams }: { searchParams: Promise<{ sort?: string }> }) {
  const { sort = "health" } = await searchParams;
  const db = readDb();
  const rows = db.accounts.map((a) => {
    const ctx = buildCtx(db, a.id)!;
    return { a, ctx, open: db.actions.filter((x) => x.accountId === a.id && x.status === "open").length };
  });
  rows.sort((x, y) =>
    sort === "renewal" ? x.a.renewalDate.localeCompare(y.a.renewalDate)
      : sort === "arr" ? y.a.arr - x.a.arr
        : (x.a.health?.score ?? 0) - (y.a.health?.score ?? 0));
  const link = (s: string, label: string) => (sort === s ? <strong>{label}</strong> : <Link href={`/?sort=${s}`}>{label}</Link>);
  return (
    <>
      <h1>Portfolio</h1>
      <p className="muted">{rows.length} accounts · sort by {link("health", "health (worst first)")} · {link("renewal", "renewal date")} · {link("arr", "ARR")}</p>
      {rows.length === 0 && <div className="card">No data yet. Run <code>npm run seed</code>.</div>}
      <div className="card tablewrap">
        <table>
          <thead><tr><th>Account</th><th>Plan</th><th>ARR</th><th>Renewal</th><th>Health</th><th>4-wk usage</th><th>Actions</th><th>Owner</th></tr></thead>
          <tbody>
            {rows.map(({ a, ctx, open }) => (
              <tr key={a.id}>
                <td><Link href={`/accounts/${a.id}`}><strong>{a.name}</strong></Link><div className="muted small">{a.segment} · {a.stage}</div></td>
                <td>{a.plan}</td>
                <td>{money(a.arr)}</td>
                <td>{ctx.daysToRenewal}d<div className="muted small">{a.renewalDate}</div></td>
                <td><HealthBadge score={a.health?.score} band={a.health?.band} /></td>
                <td><Sparkline values={ctx.usage.slice(-4).map((u) => u.meteredUnits)} /> <Delta pct={(ctx.stats.ratio - 1) * 100} /></td>
                <td>{open}</td>
                <td>{a.owner}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

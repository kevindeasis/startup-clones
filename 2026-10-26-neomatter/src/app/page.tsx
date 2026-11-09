import Link from "next/link";
import { db, lawyers } from "@/db";
import { listMatters } from "@/lib/matters";

export const dynamic = "force-dynamic";

const STATUSES = ["new", "in_review", "waiting_on_requester", "approved", "closed"] as const;
const URG: Record<string, string> = { P0: "bg-red-100 text-red-800", P1: "bg-orange-100 text-orange-800", P2: "bg-blue-100 text-blue-800", P3: "bg-stone-100 text-stone-700" };

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ status?: string; owner?: string }> }) {
  const sp = await searchParams;
  const all = listMatters();
  const rows = listMatters({ status: sp.status || undefined, owner: sp.owner || undefined });
  const owners = db.select().from(lawyers).all();
  const counts = Object.fromEntries(STATUSES.map((s) => [s, all.filter((r) => r.matter.status === s).length]));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-3">
        {STATUSES.map((s) => (
          <Link key={s} href={`/?status=${s}${sp.owner ? `&owner=${sp.owner}` : ""}`} className={`card min-w-32 ${sp.status === s ? "ring-2 ring-indigo-500" : ""}`}>
            <div className="text-2xl font-semibold">{counts[s]}</div>
            <div className="text-xs text-stone-500">{s.replaceAll("_", " ")}</div>
          </Link>
        ))}
      </div>

      <form className="flex items-end gap-3" method="get">
        <div>
          <label className="label" htmlFor="st">Status</label>
          <select id="st" name="status" defaultValue={sp.status ?? ""} className="input">
            <option value="">All</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="ow">Owner</label>
          <select id="ow" name="owner" defaultValue={sp.owner ?? ""} className="input">
            <option value="">All</option>
            {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
        <button className="btn" type="submit">Filter</button>
        <Link href="/" className="text-sm text-stone-500 underline">Reset</Link>
      </form>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase text-stone-500">
            <tr>{["Title", "Requester", "Channel", "Area", "Urgency", "Owner", "Status", "Waiting on", "Updated"].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map(({ matter: m, requesterName, channel, ownerName }) => (
              <tr key={m.id} className="border-b border-stone-100 hover:bg-stone-50">
                <td className="px-3 py-2 font-medium"><Link href={`/matters/${m.id}`} className="text-indigo-700 hover:underline">{m.title}</Link></td>
                <td className="px-3 py-2">{requesterName}</td>
                <td className="px-3 py-2"><span className="badge">{channel}</span></td>
                <td className="px-3 py-2">{m.practiceArea}</td>
                <td className="px-3 py-2"><span className={`badge ${URG[m.urgency]}`}>{m.urgency}</span></td>
                <td className="px-3 py-2">{ownerName ?? "-"}</td>
                <td className="px-3 py-2">{m.status.replaceAll("_", " ")}</td>
                <td className="px-3 py-2">{m.waitingOn ?? "-"}</td>
                <td className="px-3 py-2 whitespace-nowrap text-stone-500">{new Date(m.updatedAt).toISOString().slice(0, 16).replace("T", " ")}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={9} className="px-3 py-6 text-center text-stone-500">No matters. Run <code>npm run seed</code> or submit a request.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

"use client";
import Link from "next/link";
import { useState } from "react";
import { SECTOR_LABEL } from "@/lib/format";

export type DirRow = {
  id: string;
  name: string;
  state: string;
  sector: string;
  rating?: string;
  openFlags: number;
  lastDocumentDate: string | null;
};

export function Directory({ rows, starred: initial }: { rows: DirRow[]; starred: string[] }) {
  const [q, setQ] = useState("");
  const [starred, setStarred] = useState<Set<string>>(new Set(initial));
  const [err, setErr] = useState("");

  async function toggle(id: string) {
    const on = starred.has(id);
    const next = new Set(starred);
    if (on) next.delete(id);
    else next.add(id);
    setStarred(next);
    setErr("");
    const r = await fetch("/api/watchlists/default", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(on ? { remove: [id] } : { add: [id] }),
    });
    if (!r.ok) {
      setStarred(starred);
      setErr("Could not update the default watchlist");
    }
  }

  const needle = q.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      !needle ||
      r.name.toLowerCase().includes(needle) ||
      r.state.toLowerCase().includes(needle) ||
      (SECTOR_LABEL[r.sector] ?? r.sector).toLowerCase().includes(needle),
  );

  return (
    <div className="stack">
      <input
        type="search"
        placeholder="Filter by name, state or sector"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Filter obligors"
      />
      {err && <div className="error">{err}</div>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th aria-label="Watch" />
              <th>Obligor</th>
              <th>State</th>
              <th>Sector</th>
              <th>Rating</th>
              <th>Open flags</th>
              <th>Last document</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td>
                  <button
                    type="button"
                    className={`star${starred.has(r.id) ? " on" : ""}`}
                    onClick={() => toggle(r.id)}
                    aria-pressed={starred.has(r.id)}
                    aria-label={`${starred.has(r.id) ? "Remove" : "Add"} ${r.name} ${starred.has(r.id) ? "from" : "to"} default watchlist`}
                  >
                    {starred.has(r.id) ? "★" : "☆"}
                  </button>
                </td>
                <td>
                  <Link href={`/obligors/${r.id}`}>{r.name}</Link>
                </td>
                <td>{r.state}</td>
                <td>{SECTOR_LABEL[r.sector] ?? r.sector}</td>
                <td>{r.rating ?? "-"}</td>
                <td>{r.openFlags > 0 ? <span className="badge sev-high">{r.openFlags}</span> : 0}</td>
                <td>{r.lastDocumentDate ?? "-"}</td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={7}>No obligors match.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

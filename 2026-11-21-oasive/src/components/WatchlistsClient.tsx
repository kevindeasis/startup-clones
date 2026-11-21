"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SeverityBadge, TypeBadge } from "./Badges";
import type { Severity } from "@/lib/types";

export type WL = {
  id: string;
  name: string;
  obligorIds: string[];
  obligors: { id: string; name: string; highEvents30d: number }[];
  events: { id: string; obligorId: string; obligorName: string; type: string; severity: Severity; headline: string; date: string }[];
};

export function WatchlistsClient({ lists, all }: { lists: WL[]; all: { id: string; name: string }[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [err, setErr] = useState("");

  async function call(url: string, method: string, body?: unknown) {
    setErr("");
    const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) setErr((await r.json()).error ?? "Request failed");
    router.refresh();
  }

  return (
    <div className="stack">
      <form
        className="row"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          await call("/api/watchlists", "POST", { name });
          setName("");
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New watchlist name" aria-label="New watchlist name" />
        <button type="submit">Create watchlist</button>
      </form>
      {err && <div className="error">{err}</div>}
      {lists.map((w) => {
        const addable = all.filter((o) => !w.obligorIds.includes(o.id));
        return (
          <section key={w.id} className="panel stack" aria-label={`Watchlist ${w.name}`}>
            <div className="row between">
              <h2>{w.name}</h2>
              {w.id !== "default" && (
                <button type="button" className="ghost" onClick={() => call(`/api/watchlists/${w.id}`, "DELETE")}>
                  Delete
                </button>
              )}
            </div>
            {w.obligors.length === 0 ? (
              <p className="muted">No obligors yet.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Obligor</th>
                      <th>High events (30d)</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {w.obligors.map((o) => (
                      <tr key={o.id}>
                        <td>
                          <Link href={`/obligors/${o.id}`}>{o.name}</Link>
                        </td>
                        <td>{o.highEvents30d > 0 ? <span className="badge sev-high">{o.highEvents30d}</span> : 0}</td>
                        <td>
                          <button type="button" className="ghost" onClick={() => call(`/api/watchlists/${w.id}`, "PATCH", { remove: [o.id] })}>
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {addable.length > 0 && (
              <label>
                Add obligor
                <select
                  value=""
                  onChange={(e) => e.target.value && call(`/api/watchlists/${w.id}`, "PATCH", { add: [e.target.value] })}
                  aria-label={`Add obligor to ${w.name}`}
                >
                  <option value="">Select...</option>
                  {addable.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <h3>Combined events</h3>
            {w.events.length === 0 ? (
              <p className="muted">No events.</p>
            ) : (
              <ul className="events">
                {w.events.map((e) => (
                  <li key={e.id}>
                    <div className="row wrap">
                      <SeverityBadge s={e.severity} />
                      <TypeBadge t={e.type} />
                      <span className="muted">{e.date}</span>
                      <Link href={`/obligors/${e.obligorId}`}>{e.obligorName}</Link>
                    </div>
                    <div>{e.headline}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

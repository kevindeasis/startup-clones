"use client";

import { useEffect, useState } from "react";
import { LINE_LABELS } from "@/lib/types";
import type { Account, Gap } from "@/lib/types";
import { usd } from "@/components/format";

export default function BookPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [gaps, setGaps] = useState<Gap[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/book")
      .then((r) => r.json())
      .then((d) => setAccounts(d.accounts))
      .catch((e) => setError(String(e)));
  }, []);

  async function findGaps() {
    setBusy("gaps");
    const r = await fetch("/api/book/gaps", { method: "POST" });
    const d = await r.json();
    setGaps(d.gaps);
    setBusy(null);
  }

  async function outreach(g: Gap) {
    const key = `${g.accountId}:${g.line}`;
    setBusy(key);
    const r = await fetch("/api/book/gaps/outreach", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId: g.accountId, line: g.line }),
    });
    const d = await r.json();
    if (r.ok) setGaps((cur) => (cur ?? []).map((x) => (x.accountId === g.accountId && x.line === g.line ? { ...x, outreachEmail: d.email } : x)));
    else setError(d.error ?? "Failed");
    setBusy(null);
  }

  const nameOf = (id: string) => accounts.find((a) => a.id === id)?.name ?? id;

  return (
    <>
      <div className="row between">
        <div>
          <h1>Book of business</h1>
          <p className="muted">Seeded accounts with policies. The rule engine flags missing lines by industry.</p>
        </div>
        <button className="btn primary" onClick={findGaps} disabled={busy === "gaps"}>{busy === "gaps" ? "Scanning..." : "Find gaps"}</button>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="tableWrap"><table>
        <thead><tr><th>Account</th><th>Industry</th><th>State</th><th>Employees</th><th>Policies</th></tr></thead>
        <tbody>
          {accounts.map((a) => (
            <tr key={a.id}>
              <td><strong>{a.name}</strong></td>
              <td>{a.industry}</td>
              <td>{a.state}</td>
              <td>{a.employees}</td>
              <td>{a.policies.map((p) => `${p.line.toUpperCase()} ${usd(p.premium)} (${p.carrier}, exp ${p.expiration})`).join("; ")}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {gaps && (
        <>
          <h2>Coverage gaps ({gaps.length})</h2>
          {gaps.map((g) => (
            <div key={`${g.accountId}:${g.line}`} className="card static">
              <div className="row between">
                <div>
                  <strong>{nameOf(g.accountId)}</strong> <span className="tag warn">{LINE_LABELS[g.line]}</span>
                  <div className="small muted">{g.reason}</div>
                </div>
                <button className="btn" onClick={() => outreach(g)} disabled={busy === `${g.accountId}:${g.line}`}>Draft outreach</button>
              </div>
              {g.outreachEmail && <pre className="email">{g.outreachEmail}</pre>}
            </div>
          ))}
        </>
      )}
    </>
  );
}

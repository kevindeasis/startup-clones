"use client";

import { use, useCallback, useEffect, useState } from "react";
import { FIELD_LABEL, usd } from "@/components/format";
import { LINE_LABELS } from "@/lib/types";
import type { Opportunity, Quote } from "@/lib/types";

export default function OpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [opp, setOpp] = useState<Opportunity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/opportunities/${id}`);
    const d = await r.json();
    if (!r.ok) setError(d.error ?? "Failed to load");
    else setOpp(d.opportunity);
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function call(kind: "quote" | "compare") {
    setBusy(kind);
    setError(null);
    const r = await fetch(`/api/opportunities/${id}/${kind}`, { method: "POST" });
    const d = await r.json();
    if (!r.ok) setError(d.error ?? "Failed");
    else setOpp(d.opportunity);
    setBusy(null);
  }

  async function select(q: Quote) {
    setBusy(q.id);
    const r = await fetch(`/api/opportunities/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ selectedQuoteId: q.id }),
    });
    const d = await r.json();
    if (!r.ok) setError(d.error ?? "Failed");
    else setOpp(d.opportunity);
    setBusy(null);
  }

  if (error && !opp) return <p className="error">{error}</p>;
  if (!opp) return <p className="muted">Loading...</p>;
  const p = opp.profile;
  const rec = opp.comparison?.recommendedQuoteId;

  return (
    <>
      <div className="row between">
        <div>
          <h1>{p.businessName ?? "Unnamed business"}</h1>
          <p className="muted">Opportunity {opp.id} <span className={`tag stage-${opp.stage}`}>{opp.stage}</span></p>
        </div>
        <button className="btn primary" onClick={() => call("quote")} disabled={busy !== null || p.requestedLines.length === 0}>
          {busy === "quote" ? "Keying portals..." : "Key carrier portals"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}

      <h2>Risk profile</h2>
      <div className="card static">
        <div className="grid2 small">
          <div>Industry: {p.industry ?? "?"} {p.classCode && `(class ${p.classCode})`}</div>
          <div>Contact: {p.contactName ?? "?"} {p.contactEmail && `<${p.contactEmail}>`}</div>
          <div>Address: {[p.address?.street, p.address?.city, p.address?.state, p.address?.zip].filter(Boolean).join(", ") || "?"}</div>
          <div>Years in business: {p.yearsInBusiness ?? "?"}</div>
          <div>Revenue: {usd(p.annualRevenue)}</div>
          <div>Payroll: {usd(p.annualPayroll)}</div>
          <div>Employees: {p.employees ?? "?"}</div>
          <div>Vehicles: {p.vehicles ?? "?"}</div>
          <div>Building: {p.building ? `${p.building.squareFeet ?? "?"} sq ft, built ${p.building.yearBuilt ?? "?"}, sprinklered ${p.building.sprinklered ?? "?"}, owned ${p.building.owned ?? "?"}` : "?"}</div>
          <div>Prior claims: {p.priorClaims ? p.priorClaims.count : "?"}</div>
          <div>Effective: {p.effectiveDate ?? "?"}</div>
          <div>Requested: {p.requestedLines.map((l) => LINE_LABELS[l]).join(", ") || "none"}</div>
        </div>
        {p.description && <p className="small muted">{p.description}</p>}
        {p.notes && <p className="small muted">Notes: {p.notes}</p>}
      </div>

      <h2>Missing items ({opp.missing.length})</h2>
      {opp.missing.length === 0 ? <p className="muted">Nothing missing.</p> : (
        <ul>
          {opp.missing.map((m, i) => (
            <li key={i}><span className="tag warn">{m.line}</span> {FIELD_LABEL[m.field] ?? m.field} <span className="muted small">- {m.why}</span></li>
          ))}
        </ul>
      )}
      {opp.followUpEmail && (<><h2>Follow-up email draft</h2><pre className="email">{opp.followUpEmail}</pre></>)}

      <h2>Quotes ({opp.quotes.length})</h2>
      {opp.quotes.length === 0 ? <p className="muted">No quotes yet. Key the carrier portals to start.</p> : (
        <div className="quotes">
          {opp.quotes.map((q) => (
            <div key={q.id} className={`card static quote ${q.status}${opp.selectedQuoteId === q.id ? " selected" : ""}`}>
              <div className="row between">
                <strong>{q.carrierName}</strong>
                <span className={`tag status-${q.status}`}>{q.status}</span>
              </div>
              <div className="small muted">{LINE_LABELS[q.line]}</div>
              {q.status === "quoted" ? (
                <>
                  <div className="price">{usd(q.premium)}<span className="small muted"> / yr</span></div>
                  <div className="small">Deductible {usd(q.deductible)}</div>
                </>
              ) : <div className="small">{q.reason}</div>}
              <details>
                <summary className="small">Step log ({q.log.length})</summary>
                <ol className="log small">{q.log.map((l, i) => <li key={i}>{l}</li>)}</ol>
              </details>
            </div>
          ))}
        </div>
      )}

      {opp.quotes.some((q) => q.status === "quoted") && (
        <>
          <div className="row between">
            <h2>Compare</h2>
            <button className="btn" onClick={() => call("compare")} disabled={busy !== null}>{busy === "compare" ? "Comparing..." : "Compare"}</button>
          </div>
          {opp.comparison && (
            <>
              <div className="tableWrap"><table>
                <thead><tr><th>Carrier</th><th>Line</th><th>Premium</th><th>Deductible</th><th>Limits</th><th>Coverages</th><th>Exclusions</th><th /></tr></thead>
                <tbody>
                  {opp.comparison.diff?.rows.map((r) => {
                    const q = opp.quotes.find((x) => x.id === r.quoteId);
                    const lc = opp.comparison?.diff?.byLine.find((l) => l.line === r.line);
                    return (
                      <tr key={r.quoteId} className={opp.selectedQuoteId === r.quoteId ? "selected-row" : ""}>
                        <td>{r.carrierName}{rec === r.quoteId && <span className="tag good">recommended</span>}</td>
                        <td>{r.line}</td>
                        <td>{usd(r.premium)}{lc?.cheapestQuoteId === r.quoteId && <span className="tag">cheapest</span>}</td>
                        <td>{usd(r.deductible)}</td>
                        <td className="small">{Object.entries(r.limits).map(([k, v]) => `${k}: ${usd(v)}`).join("; ")}</td>
                        <td className="small">{r.coverages.join("; ")}{lc?.broadestQuoteId === r.quoteId && <span className="tag">broadest</span>}</td>
                        <td className="small">{r.exclusions.join("; ")}</td>
                        <td>{q && (opp.selectedQuoteId === q.id ? <span className="tag good">Selected</span> : <button className="btn" onClick={() => select(q)} disabled={busy !== null}>Select this quote</button>)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table></div>
              <h3>Recommendation</h3>
              <p>{opp.comparison.summary}</p>
              <h3>Proposal email draft</h3>
              <pre className="email">{opp.comparison.proposalEmail}</pre>
              <p className="small muted">Human approval required: selecting a quote does not bind coverage.</p>
            </>
          )}
        </>
      )}
    </>
  );
}

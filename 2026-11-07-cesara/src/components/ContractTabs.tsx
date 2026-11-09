"use client";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { ClaimRow, ContractTerms, Term } from "@/lib/types";
import { money } from "@/lib/format";

type Tab = "terms" | "claims" | "under" | "ask" | "whatif";
interface Summary {
  total: number;
  underpaid: number;
  overpaid: number;
  ok: number;
  no_rate_found: number;
  total_underpaid_amount: number;
  recovered_amount: number;
}

const FLAG_STYLE: Record<string, string> = {
  underpaid: "bg-red-100 text-red-800",
  overpaid: "bg-purple-100 text-purple-800",
  ok: "bg-emerald-100 text-emerald-800",
  no_rate_found: "bg-slate-200 text-slate-700",
};
const STATUS_STYLE: Record<string, string> = {
  open: "bg-amber-100 text-amber-800",
  appealed: "bg-blue-100 text-blue-800",
  recovered: "bg-emerald-100 text-emerald-800",
  closed: "bg-slate-200 text-slate-700",
};
const chip = (cls: string, text: string) => (
  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{text}</span>
);

export default function ContractTabs({ contractId, terms }: { contractId: string; terms: ContractTerms }) {
  const [tab, setTab] = useState<Tab>("terms");
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    const [c, s] = await Promise.all([
      fetch(`/api/contracts/${contractId}/claims`).then((r) => r.json()),
      fetch(`/api/contracts/${contractId}`).then((r) => r.json()),
    ]);
    setClaims(Array.isArray(c) ? c : []);
    setSummary(s.summary ?? null);
  }, [contractId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    reload().catch(() => setError("Could not load claims"));
  }, [reload]);

  async function uploadClaims(init: RequestInit) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/contracts/${contractId}/claims`, { method: "POST", ...init });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      await reload();
      setTab("under");
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  const tabs: [Tab, string][] = [
    ["terms", "Terms"],
    ["claims", "Claims"],
    ["under", "Underpayments"],
    ["ask", "Ask"],
    ["whatif", "What-if"],
  ];

  return (
    <div>
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200">
        {tabs.map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${tab === k ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {tab === "terms" && <TermsTab terms={terms} />}
      {tab === "claims" && <ClaimsTab claims={claims} busy={busy} onUpload={uploadClaims} />}
      {tab === "under" && <UnderTab claims={claims} summary={summary} />}
      {tab === "ask" && <AskTab contractId={contractId} />}
      {tab === "whatif" && <WhatIfTab contractId={contractId} terms={terms} hasClaims={claims.length > 0} />}
    </div>
  );
}

// ------------------------------------------------------------------ Terms
function termValue(t: Term) {
  const parts: string[] = [];
  if (t.rate !== undefined) parts.push(money(t.rate));
  if (t.percent !== undefined) parts.push(`${t.percent}%`);
  return parts.join(" / ") || "-";
}

function TermsTab({ terms }: { terms: ContractTerms }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-3 py-2">Id</th>
            <th className="px-3 py-2">Kind</th>
            <th className="px-3 py-2">Code</th>
            <th className="px-3 py-2">Rate / %</th>
            <th className="px-3 py-2">Threshold</th>
            <th className="px-3 py-2">Applies to</th>
          </tr>
        </thead>
        <tbody>
          {terms.terms.map((t) => (
            <Fragment key={t.id}>
              <tr onClick={() => setOpen(open === t.id ? null : t.id)} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2 font-mono text-xs">{t.id}</td>
                <td className="px-3 py-2">{t.kind.replace(/_/g, " ")}</td>
                <td className="px-3 py-2">{t.code ? `${t.code_type ?? ""} ${t.code}` : "-"}</td>
                <td className="px-3 py-2">{termValue(t)}</td>
                <td className="px-3 py-2">{t.threshold !== undefined ? money(t.threshold) : "-"}</td>
                <td className="px-3 py-2">{t.applies_to ?? "-"}</td>
              </tr>
              {open === t.id && (
                <tr key={t.id + "-c"} className="bg-emerald-50">
                  <td colSpan={6} className="px-3 py-3 text-sm">
                    {t.description && <div className="mb-1 text-slate-600">{t.description}</div>}
                    <blockquote className="border-l-4 border-emerald-500 pl-3 italic text-slate-700">{t.source_clause}</blockquote>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
      <div className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
        Timely filing: {terms.admin.timely_filing_days ?? "-"} days &middot; Appeal window: {terms.admin.appeal_window_days ?? "-"} days. Click a row to see the verbatim clause.
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- Claims
function ClaimsTab({ claims, busy, onUpload }: { claims: ClaimRow[]; busy: boolean; onUpload: (i: RequestInit) => void }) {
  const [filter, setFilter] = useState("all");
  const fileRef = useRef<HTMLInputElement>(null);
  const shown = claims.filter((c) => filter === "all" || (filter === "no_rate" ? c.flag === "no_rate_found" : c.flag === filter));
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="text-sm"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const fd = new FormData();
            fd.append("file", f);
            onUpload({ body: fd });
          }}
        />
        <button
          disabled={busy}
          onClick={() => onUpload({ headers: { "content-type": "application/json" }, body: JSON.stringify({ sample: true }) })}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Checking..." : "Load sample claims"}
        </button>
        <div className="ml-auto flex gap-1">
          {["all", "underpaid", "overpaid", "no_rate"].map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`rounded-md px-2 py-1 text-xs ${filter === f ? "bg-slate-800 text-white" : "bg-white border border-slate-300"}`}>
              {f === "no_rate" ? "no rate" : f}
            </button>
          ))}
        </div>
      </div>
      <p className="mb-2 text-xs text-slate-500">CSV columns: claim_id, patient_ref, service_date, code_type, code, description, units, billed_charges, paid_amount.</p>
      <ClaimsTable claims={shown} />
    </div>
  );
}

function ClaimsTable({ claims }: { claims: ClaimRow[] }) {
  if (!claims.length) return <p className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">No claims to show.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-3 py-2">Claim</th>
            <th className="px-3 py-2">Date</th>
            <th className="px-3 py-2">Code</th>
            <th className="px-3 py-2 text-right">Billed</th>
            <th className="px-3 py-2 text-right">Expected</th>
            <th className="px-3 py-2 text-right">Paid</th>
            <th className="px-3 py-2 text-right">Variance</th>
            <th className="px-3 py-2">Flag</th>
          </tr>
        </thead>
        <tbody>
          {claims.map((c) => (
            <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
              <td className="px-3 py-2"><Link className="text-emerald-700 hover:underline" href={`/claims/${c.id}`}>{c.claim_id}</Link></td>
              <td className="px-3 py-2">{c.service_date}</td>
              <td className="px-3 py-2">{c.code_type} {c.code}</td>
              <td className="px-3 py-2 text-right">{money(c.billed_charges)}</td>
              <td className="px-3 py-2 text-right">{money(c.expected_amount)}</td>
              <td className="px-3 py-2 text-right">{money(c.paid_amount)}</td>
              <td className="px-3 py-2 text-right">{money(c.variance)}</td>
              <td className="px-3 py-2">{chip(FLAG_STYLE[c.flag] ?? "", c.flag.replace(/_/g, " "))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------- Underpayments
function UnderTab({ claims, summary }: { claims: ClaimRow[]; summary: Summary | null }) {
  const under = claims.filter((c) => c.flag === "underpaid").sort((a, b) => (b.variance ?? 0) - (a.variance ?? 0));
  const tiles: [string, string][] = [
    ["Claims checked", String(summary?.total ?? 0)],
    ["Underpaid claims", String(summary?.underpaid ?? 0)],
    ["Total $ underpaid", money(summary?.total_underpaid_amount ?? 0)],
    ["$ recovered", money(summary?.recovered_amount ?? 0)],
  ];
  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map(([k, v]) => (
          <div key={k} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="text-xs text-slate-500">{k}</div>
            <div className="text-xl font-semibold">{v}</div>
          </div>
        ))}
      </div>
      {under.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">No underpayments yet. Load claims in the Claims tab.</p>
      ) : (
        <ul className="space-y-2">
          {under.map((c) => (
            <li key={c.id}>
              <Link href={`/claims/${c.id}`} className="block rounded-lg border border-slate-200 bg-white p-3 hover:border-emerald-500">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium">{c.claim_id} <span className="font-normal text-slate-500">&middot; {c.code_type} {c.code} &middot; {c.service_date}</span></div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-red-600">{money(c.variance)}</span>
                    {chip(STATUS_STYLE[c.status] ?? "", c.status)}
                  </div>
                </div>
                <div className="mt-1 text-xs text-slate-500">Expected {money(c.expected_amount)} &middot; paid {money(c.paid_amount)} &middot; clause {c.clause_ref}</div>
                <div className="mt-1 text-sm text-slate-700">{c.reason}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// -------------------------------------------------------------------- Ask
function AskTab({ contractId }: { contractId: string }) {
  const [msgs, setMsgs] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(q: string) {
    if (!q.trim() || busy) return;
    const next = [...msgs, { role: "user" as const, content: q }];
    setMsgs([...next, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch(`/api/contracts/${contractId}/ask`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error || "Request failed");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setMsgs([...next, { role: "assistant", content: acc }]);
      }
    } catch (e) {
      setMsgs([...next, { role: "assistant", content: `Error: ${(e as Error).message}` }]);
    }
    setBusy(false);
  }

  const suggestions = ["What is the stop-loss threshold?", "Is there a rate increase?", "How are implants paid?", "What is the timely filing limit?"];
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 min-h-40 space-y-3">
        {msgs.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button key={s} onClick={() => send(s)} className="rounded-full border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50">{s}</button>
            ))}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : ""}>
            <div className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-left text-sm ${m.role === "user" ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-800"}`}>
              {m.content || "..."}
            </div>
          </div>
        ))}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex gap-2">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about this contract..." className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <button disabled={busy} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Ask</button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- What-if
function WhatIfTab({ contractId, terms, hasClaims }: { contractId: string; terms: ContractTerms; hasClaims: boolean }) {
  const editable = terms.terms.filter((t) => t.rate !== undefined || t.percent !== undefined || t.threshold !== undefined);
  const [termId, setTermId] = useState(editable[0]?.id ?? "");
  const term = editable.find((t) => t.id === termId);
  const [vals, setVals] = useState({ rate: "", percent: "", threshold: "" });
  const [res, setRes] = useState<{ before_total: number; after_total: number; delta: number; changed_claims: number } | null>(null);
  const [error, setError] = useState("");

  async function run() {
    setError("");
    const body: Record<string, unknown> = { term_id: termId };
    for (const k of ["rate", "percent", "threshold"] as const) if (vals[k] !== "") body[k] = Number(vals[k]);
    const r = await fetch(`/api/contracts/${contractId}/whatif`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await r.json();
    if (!r.ok) return setError(data.error || "Failed");
    setRes(data);
  }

  const field = (k: "rate" | "percent" | "threshold", label: string) =>
    term && term[k] !== undefined ? (
      <label className="text-sm">
        <span className="mb-1 block text-xs text-slate-500">{label} (now {term[k]})</span>
        <input type="number" step="any" value={vals[k]} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} className="w-40 rounded-md border border-slate-300 px-2 py-1.5" />
      </label>
    ) : null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="mb-3 text-sm text-slate-600">Change one term and see how total expected payment over the loaded claims would move. Nothing is saved.</p>
      {!hasClaims && <p className="mb-3 text-sm text-amber-700">Load claims first (Claims tab) to see an impact.</p>}
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-slate-500">Term</span>
          <select value={termId} onChange={(e) => { setTermId(e.target.value); setVals({ rate: "", percent: "", threshold: "" }); setRes(null); }} className="rounded-md border border-slate-300 px-2 py-1.5">
            {editable.map((t) => (
              <option key={t.id} value={t.id}>{t.id} ({t.kind.replace(/_/g, " ")})</option>
            ))}
          </select>
        </label>
        {field("rate", "New rate ($)")}
        {field("percent", "New percent (%)")}
        {field("threshold", "New threshold ($)")}
        <button onClick={run} className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white">Recompute</button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {res && (
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ["Expected today", money(res.before_total)],
            ["Expected with change", money(res.after_total)],
            ["Delta", money(res.delta)],
            ["Claims affected", String(res.changed_claims)],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg border border-slate-200 p-3">
              <div className="text-xs text-slate-500">{k}</div>
              <div className="text-lg font-semibold">{v}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

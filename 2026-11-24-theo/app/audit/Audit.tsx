"use client";
import Link from "next/link";
import { useState } from "react";
import type { AuditReport } from "@/lib/schema";

export default function Audit() {
  const [url, setUrl] = useState("");
  const [html, setHtml] = useState("");
  const [showHtml, setShowHtml] = useState(false);
  const [r, setR] = useState<AuditReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(""); setR(null);
    try {
      const res = await fetch("/api/audit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(html.trim() ? { html, url: url || undefined } : { url }) });
      const j = await res.json();
      if (!res.ok) { setError(j.error || "Audit failed"); setShowHtml(true); } else setR(j);
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  const color = r ? (r.score >= 75 ? "#059669" : r.score >= 50 ? "#d97706" : "#dc2626") : "#000";
  const build = r ? `/new?${new URLSearchParams({ name: r.extracted.businessNameGuess ?? "", city: (r.extracted.locationGuess ?? "").split(",")[0], url: r.url.startsWith("http") ? r.url : "", services: r.extracted.servicesGuess.slice(0, 4).join(", ") })}` : "";
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Free site audit</h1>
      <p className="text-slate-600">Can Google understand your pages, services and locations? No login needed.</p>
      <form onSubmit={run} className="card space-y-3">
        <input className="input" placeholder="https://yourbusiness.com" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Website URL" />
        <button type="button" className="text-xs underline" onClick={() => setShowHtml(!showHtml)}>{showHtml ? "Hide" : "Or paste raw HTML"}</button>
        {showHtml && <textarea className="input h-32 font-mono" placeholder="<html>...</html>" value={html} onChange={(e) => setHtml(e.target.value)} />}
        <button className="btn" disabled={busy || (!url.trim() && !html.trim())}>{busy ? "Auditing..." : "Run audit"}</button>
      </form>
      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
      {r && (
        <div className="space-y-6">
          <div className="card flex items-center gap-6">
            <svg width="110" height="110" viewBox="0 0 110 110" aria-label={`Score ${r.score}`}>
              <circle cx="55" cy="55" r="46" fill="none" stroke="#e2e8f0" strokeWidth="10" />
              <circle cx="55" cy="55" r="46" fill="none" stroke={color} strokeWidth="10" strokeDasharray={`${(r.score / 100) * 289} 289`} transform="rotate(-90 55 55)" strokeLinecap="round" />
              <text x="55" y="62" textAnchor="middle" fontSize="26" fontWeight="700">{r.score}</text>
            </svg>
            <div><p className="text-sm text-slate-500">{r.url}</p><p className="mt-1">{r.summary}</p></div>
          </div>
          <table className="card w-full text-sm"><tbody>
            {r.checks.map((c) => (<tr key={c.id} className="border-b border-slate-100 last:border-0"><td className="p-2 font-semibold" style={{ color: c.passed ? "#059669" : "#dc2626" }}>{c.passed ? "Pass" : "Fail"}</td><td className="p-2">{c.label}</td><td className="p-2 text-slate-500">{c.detail}</td></tr>))}
          </tbody></table>
          <div className="space-y-2">
            <h2 className="font-semibold">Top fixes</h2>
            {r.fixes.map((f, i) => (<div key={i} className="card"><p className="font-semibold">{f.title} <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs uppercase">{f.priority}</span></p><p className="text-sm text-slate-600">{f.why}</p><p className="text-sm">{f.how}</p></div>))}
          </div>
          <Link href={build} className="btn">Build a new site with these details</Link>
        </div>
      )}
    </div>
  );
}

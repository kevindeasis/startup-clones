"use client";
import { useState } from "react";
import type { Site } from "@/lib/schema";

type Tab = "pages" | "growth" | "export";

export default function Workspace({ initial }: { initial: Site }) {
  const [site, setSite] = useState(initial);
  const [tab, setTab] = useState<Tab>("pages");
  const [msg, setMsg] = useState("");
  const [log, setLog] = useState<{ role: string; text: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rev, setRev] = useState(0);

  async function api(url: string, method: string, body?: unknown) {
    const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "Request failed");
    return j;
  }
  async function wrap(fn: () => Promise<void>) {
    setBusy(true); setError("");
    try { await fn(); setRev((x) => x + 1); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const base = `/api/sites/${site.id}`;
  const send = (e: React.FormEvent) => { e.preventDefault(); const m = msg.trim(); if (!m) return; setMsg(""); setLog((l) => [...l, { role: "you", text: m }]);
    wrap(async () => { const j = await api(`${base}/chat`, "POST", { message: m }); setSite(j.site); setLog((l) => [...l, { role: "theo", text: j.summary }]); }); };
  const revert = (id: string) => wrap(async () => setSite(await api(`${base}/revert`, "POST", { versionId: id })));
  const runGrowth = () => wrap(async () => setSite((await api(`${base}/growth/run`, "POST")).site));
  const act = (id: string, action: string) => wrap(async () => setSite(await api(`${base}/growth/${id}`, "POST", { action })));
  const toggle = (v: boolean) => wrap(async () => setSite(await api(`${base}/growth`, "PATCH", { autoPublish: v })));
  const drafts = site.growth.drafts.filter((d) => d.status === "draft");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h1 className="text-xl font-bold">{site.business.name}</h1><a className="btn-ghost" href={`/s/${site.slug}`} target="_blank">Open public site</a></div>
      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <aside className="space-y-4">
          <div className="card space-y-2">
            <h2 className="font-semibold">Chat edits</h2>
            <div className="max-h-56 space-y-1 overflow-auto text-sm">
              {log.length === 0 && <p className="text-slate-500">Try: &quot;add a drain-cleaning service&quot;, &quot;make the hero headline shorter&quot;, &quot;move the FAQ above the CTA&quot;.</p>}
              {log.map((l, i) => <p key={i} className={l.role === "you" ? "text-slate-900" : "text-emerald-700"}><b>{l.role}:</b> {l.text}</p>)}
            </div>
            <form onSubmit={send} className="flex gap-2"><input className="input" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Ask for a change..." aria-label="Chat message" /><button className="btn" disabled={busy}>Send</button></form>
          </div>
          <div className="card"><h2 className="mb-2 font-semibold">Versions</h2>
            <ul className="max-h-64 space-y-1 overflow-auto text-sm">{[...site.versions].reverse().map((v, i) => (
              <li key={v.id} className="flex items-center justify-between gap-2"><span className="truncate" title={v.summary}>{v.summary}</span>{i === 0 ? <span className="text-xs text-slate-400">current</span> : <button className="btn-ghost" disabled={busy} onClick={() => revert(v.id)}>Revert</button>}</li>
            ))}</ul>
          </div>
        </aside>
        <section className="space-y-3">
          <iframe key={rev} src={`/s/${site.slug}`} title="Site preview" className="h-[420px] w-full rounded-xl border border-slate-200 bg-white" />
          <div className="flex gap-2">{(["pages", "growth", "export"] as Tab[]).map((t) => <button key={t} className={tab === t ? "btn" : "btn-ghost"} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}{t === "growth" && drafts.length ? ` (${drafts.length})` : ""}</button>)}</div>
          {tab === "pages" && <ul className="card space-y-1 text-sm">{site.pages.map((p) => <li key={p.id}><a className="underline" href={`/s/${site.slug}${p.path === "/" ? "" : p.path}`} target="_blank">{p.path}</a> <span className="text-slate-500">{p.type} &middot; {p.title}</span></li>)}</ul>}
          {tab === "growth" && (
            <div className="space-y-3">
              <div className="card flex flex-wrap items-center gap-4"><button className="btn" disabled={busy} onClick={runGrowth}>{busy ? "Working..." : "Run growth agent"}</button>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={site.growth.autoPublish} onChange={(e) => toggle(e.target.checked)} /> Auto-publish pages and posts</label>
                <span className="text-xs text-slate-500">Manual run (a weekly cron is the next step).</span></div>
              {drafts.length === 0 && <p className="text-sm text-slate-500">No pending drafts.</p>}
              {drafts.map((d) => (
                <div key={d.id} className="card text-sm"><p><span className="mr-2 rounded bg-slate-100 px-2 py-0.5 text-xs uppercase">{d.kind}</span><b>{d.page?.title ?? d.fix?.title}</b></p>
                  <p className="text-slate-600">{d.rationale}</p>{d.page && <p className="text-xs text-slate-500">{d.page.path}</p>}{d.fix && <p>{d.fix.detail}</p>}
                  <div className="mt-2 flex gap-2"><button className="btn" disabled={busy} onClick={() => act(d.id, "publish")}>Publish</button><button className="btn-ghost" disabled={busy} onClick={() => act(d.id, "dismiss")}>Dismiss</button></div></div>
              ))}
              <div className="card text-sm"><h3 className="mb-1 font-semibold">Run log</h3>{site.growth.runs.length === 0 ? <p className="text-slate-500">No runs yet.</p> : <ul className="space-y-1">{[...site.growth.runs].reverse().map((r) => <li key={r.id}>{new Date(r.at).toLocaleString()} &middot; {r.source} &middot; {r.draftIds.length} drafts &middot; {r.keywordIdeas.length} keyword ideas</li>)}</ul>}</div>
            </div>
          )}
          {tab === "export" && (
            <div className="card space-y-2 text-sm"><p>Writes static HTML, sitemap.xml and robots.txt to <code>exports/{site.slug}/</code> and downloads a zip.</p>
              <button className="btn" disabled={busy} onClick={() => wrap(async () => { const r = await fetch(`${base}/export`, { method: "POST" }); if (!r.ok) throw new Error("Export failed"); const b = await r.blob(); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `${site.slug}.zip`; a.click(); })}>Export static site</button></div>
          )}
        </section>
      </div>
    </div>
  );
}

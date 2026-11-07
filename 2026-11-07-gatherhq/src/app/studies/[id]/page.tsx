"use client";
import { use, useCallback, useEffect, useState } from "react";
import type { BuyerModel, Reaction } from "@/lib/schemas";

type Study = { id: string; title: string; goal: string; audience: string; status: string };
type Q = { id: string; position: number; text: string };
type Iv = { id: string; token: string; participant_name: string | null; synthetic: number; status: string; message_count: number };
type Data = { study: Study; questions: Q[]; interviews: Iv[]; model: { version: number; model: BuyerModel } | null };
type Cite = { interview_id: string; participant: string; excerpt: string };

const btn = "rounded-md border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-100 disabled:opacity-50 dark:border-stone-700 dark:hover:bg-stone-800";
const primary = "rounded-md bg-stone-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900";
const input = "w-full rounded-md border border-stone-300 bg-transparent px-3 py-2 text-sm dark:border-stone-700";
const post = (url: string, b: unknown) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });

/** Render text, turning [int:<id>] into a short badge. */
function Cited({ text }: { text: string }) {
  const parts = text.split(/(\[int:[A-Za-z0-9_-]+\])/g);
  return <>{parts.map((p, i) => { const m = p.match(/^\[int:(.+)\]$/); return m ? <code key={i} className="mx-0.5 rounded bg-indigo-100 px-1 text-xs text-indigo-900">int:{m[1]}</code> : <span key={i}>{p}</span>; })}</>;
}

export default function StudyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<Data | null>(null);
  const [qs, setQs] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [tab, setTab] = useState<"model" | "ask" | "sim">("model");
  const [n, setN] = useState(3);

  const load = useCallback(async () => {
    const res = await fetch(`/api/studies/${id}`);
    if (!res.ok) return setMsg("Study not found");
    const d: Data = await res.json();
    setData(d); setQs(d.questions.map((q) => q.text));
  }, [id]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  async function run(label: string, fn: () => Promise<Response>, ok?: string) {
    setBusy(label); setMsg("");
    const r = await fn();
    const j = await r.json().catch(() => ({}));
    setBusy("");
    if (!r.ok) setMsg(j.error || "Failed"); else if (ok) setMsg(ok);
    await load();
  }

  if (!data) return <p className="text-stone-500">{msg || "Loading..."}</p>;
  const { study, interviews, model } = data;
  const complete = interviews.filter((i) => i.status === "complete").length;
  const link = (t: string) => `${location.origin}/interview/${t}`;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">{study.title}</h1>
        <p className="mt-1 text-sm text-stone-600 dark:text-stone-400"><b>Goal:</b> {study.goal}</p>
        <p className="text-sm text-stone-600 dark:text-stone-400"><b>Audience:</b> {study.audience}</p>
      </div>

      {msg && <p className="rounded-md bg-stone-100 p-2 text-sm dark:bg-stone-800" role="status">{msg}</p>}

      <section>
        <h2 className="mb-2 text-lg font-semibold">Interview guide</h2>
        <ol className="space-y-2">
          {qs.map((q, i) => (
            <li key={i} className="flex gap-2">
              <span className="w-5 pt-2 text-sm text-stone-400">{i + 1}.</span>
              <input className={input} value={q} onChange={(e) => setQs(qs.map((x, j) => (j === i ? e.target.value : x)))} />
              <button className={btn} onClick={() => setQs(qs.filter((_, j) => j !== i))} aria-label="Remove question">x</button>
            </li>
          ))}
        </ol>
        <div className="mt-2 flex gap-2">
          <button className={btn} onClick={() => setQs([...qs, ""])}>Add question</button>
          <button className={primary} disabled={!!busy} onClick={() => run("save", () => fetch(`/api/studies/${id}/questions`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ questions: qs }) }), "Guide saved.")}>Save guide</button>
        </div>
      </section>

      <section>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-lg font-semibold">Interviews ({complete}/{interviews.length} complete)</h2>
          <button className={btn} disabled={!!busy} onClick={async () => {
            const r = await post(`/api/studies/${id}/interviews`, {}); const j = await r.json();
            try { await navigator.clipboard.writeText(j.url); setMsg(`Interview link copied: ${j.url}`); } catch { setMsg(`Interview link: ${j.url}`); }
            load();
          }}>Copy interview link</button>
          <label className="flex items-center gap-1 text-sm">N <input type="number" min={1} max={8} value={n} onChange={(e) => setN(Number(e.target.value))} className="w-14 rounded-md border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700" /></label>
          <button className={btn} disabled={!!busy} onClick={() => run("panel", () => post(`/api/studies/${id}/synthetic`, { n }), "Synthetic panel complete.")}>{busy === "panel" ? "Running panel..." : "Run synthetic panel"}</button>
          <button className={primary} disabled={!!busy || complete === 0} onClick={() => run("synth", () => post(`/api/studies/${id}/synthesize`, {}), "Buyer model updated.")}>{busy === "synth" ? "Synthesizing..." : "Synthesize"}</button>
          <a className={btn} href={`/api/studies/${id}/report`} download>Download report</a>
        </div>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-stone-200 text-left text-stone-500 dark:border-stone-800"><th className="py-1">Participant</th><th>Status</th><th>Messages</th><th>Link</th></tr></thead>
          <tbody>
            {interviews.map((iv) => (
              <tr key={iv.id} className="border-b border-stone-100 dark:border-stone-900">
                <td className="py-1">{iv.participant_name || "Anonymous"} {iv.synthetic ? <span className="ml-1 rounded bg-violet-100 px-1.5 text-xs text-violet-900">synthetic</span> : null} <code className="text-xs text-stone-400">{iv.id}</code></td>
                <td>{iv.status}</td><td>{iv.message_count}</td>
                <td><a className="text-indigo-600 underline" href={`/interview/${iv.token}`} target="_blank">open</a> <button className="text-xs text-stone-500 underline" onClick={() => navigator.clipboard?.writeText(link(iv.token))}>copy</button></td>
              </tr>
            ))}
            {interviews.length === 0 && <tr><td colSpan={4} className="py-2 text-stone-500">No interviews yet.</td></tr>}
          </tbody>
        </table>
      </section>

      <section>
        <div className="mb-3 flex gap-1 border-b border-stone-200 dark:border-stone-800">
          {([["model", "Buyer model"], ["ask", "Ask the model"], ["sim", "Simulate"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`px-3 py-2 text-sm ${tab === k ? "border-b-2 border-stone-900 font-medium dark:border-stone-100" : "text-stone-500"}`}>{l}</button>
          ))}
        </div>
        {tab === "model" && <ModelView model={model?.model ?? null} version={model?.version} />}
        {tab === "ask" && <Ask id={id} />}
        {tab === "sim" && <Sim id={id} hasModel={!!model} />}
      </section>
    </div>
  );
}

function ModelView({ model, version }: { model: BuyerModel | null; version?: number }) {
  if (!model) return <p className="text-sm text-stone-500">No buyer model yet. Complete some interviews (or run a synthetic panel) and click Synthesize.</p>;
  return (
    <div className="space-y-5" data-testid="buyer-model">
      <p className="text-xs text-stone-400">Version {version}</p>
      <p>{model.summary}</p>
      <div><h3 className="mb-1 font-semibold">Themes</h3>
        {model.themes.map((t, i) => (
          <div key={i} className="mb-3 rounded-lg border border-stone-200 p-3 dark:border-stone-800">
            <div className="font-medium">{t.title}</div><p className="text-sm text-stone-600 dark:text-stone-400">{t.description}</p>
            {t.evidence.map((e, j) => <blockquote key={j} className="mt-1 border-l-2 border-stone-300 pl-2 text-sm italic">&ldquo;{e.quote}&rdquo; <Cited text={`[int:${e.interview_id}]`} /></blockquote>)}
          </div>))}
      </div>
      <div><h3 className="mb-1 font-semibold">Segments</h3><ul className="space-y-1 text-sm">{model.segments.map((s, i) => <li key={i}><b>{s.name}</b> ({s.share_estimate}): {s.description}</li>)}</ul></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><h3 className="mb-1 font-semibold">Objections</h3><ul className="list-disc pl-5 text-sm">{model.objections.map((o, i) => <li key={i}>{o}</li>)}</ul></div>
        <div><h3 className="mb-1 font-semibold">Jobs to be done</h3><ul className="list-disc pl-5 text-sm">{model.jobs_to_be_done.map((o, i) => <li key={i}>{o}</li>)}</ul></div>
      </div>
      <div><h3 className="mb-1 font-semibold">Recommended messages</h3><ul className="list-disc pl-5 text-sm">{model.recommended_messages.map((o, i) => <li key={i}>{o}</li>)}</ul></div>
    </div>
  );
}

function Ask({ id }: { id: string }) {
  const [q, setQ] = useState("");
  const [log, setLog] = useState<{ q: string; a: string; cites: Cite[] }[]>([]);
  const [busy, setBusy] = useState(false);
  async function ask(e: React.FormEvent) {
    e.preventDefault(); if (!q.trim()) return;
    const question = q; setQ(""); setBusy(true);
    const r = await post(`/api/studies/${id}/ask`, { question }); const j = await r.json();
    setBusy(false);
    setLog((l) => [...l, { q: question, a: r.ok ? j.answer : j.error, cites: j.citations ?? [] }]);
  }
  return (
    <div className="space-y-3">
      {log.map((m, i) => (
        <div key={i} className="space-y-1">
          <div className="text-sm font-medium">Q: {m.q}</div>
          <div className="whitespace-pre-wrap rounded-lg bg-stone-100 p-3 text-sm dark:bg-stone-800"><Cited text={m.a} /></div>
          {m.cites.length > 0 && <details className="text-xs text-stone-500"><summary>{m.cites.length} cited excerpt(s)</summary>{m.cites.map((c, j) => <pre key={j} className="mt-1 whitespace-pre-wrap">[int:{c.interview_id}] {c.participant}{"\n"}{c.excerpt}</pre>)}</details>}
        </div>))}
      <form onSubmit={ask} className="flex gap-2">
        <input className={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about your buyers, e.g. What stops them from buying?" />
        <button className={primary} disabled={busy}>{busy ? "..." : "Ask"}</button>
      </form>
    </div>
  );
}

function Sim({ id, hasModel }: { id: string; hasModel: boolean }) {
  const [s, setS] = useState("");
  const [res, setRes] = useState<{ disclaimer: string; reactions: Reaction[] } | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function go(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    const r = await post(`/api/studies/${id}/simulate`, { stimulus: s }); const j = await r.json();
    setBusy(false);
    if (!r.ok) return setErr(j.error); setRes(j);
  }
  return (
    <div className="space-y-3">
      {!hasModel && <p className="text-sm text-stone-500">Synthesize a buyer model first.</p>}
      <form onSubmit={go} className="space-y-2">
        <textarea className={input} rows={3} value={s} onChange={(e) => setS(e.target.value)} placeholder="Paste a message, pricing change or product idea..." />
        <button className={primary} disabled={busy || !s.trim() || !hasModel}>{busy ? "Simulating..." : "Simulate reactions"}</button>
      </form>
      {err && <p className="text-sm text-red-600">{err}</p>}
      {res && (
        <div className="space-y-2">
          <p className="rounded-md bg-amber-100 p-2 text-sm text-amber-900">{res.disclaimer}</p>
          {res.reactions.map((r, i) => (
            <div key={i} className="rounded-lg border border-stone-200 p-3 text-sm dark:border-stone-800">
              <div className="flex justify-between"><b>{r.segment}</b><span className={r.sentiment > 0 ? "text-green-600" : r.sentiment < 0 ? "text-red-600" : "text-stone-500"}>sentiment {r.sentiment > 0 ? "+" : ""}{r.sentiment}</span></div>
              <p>{r.reaction}</p>
              <p className="text-stone-500"><b>Likely objection:</b> {r.likely_objection}</p>
              <p className="italic text-stone-500">{r.quote_style_example}</p>
            </div>))}
        </div>)}
    </div>
  );
}

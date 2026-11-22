"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";

async function call(url: string, method: string, body?: unknown, raw?: string, contentType = "application/json") {
  const res = await fetch(url, { method, headers: { "content-type": contentType }, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

function useBusy() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true); setMsg(null);
    try { const t = await fn(); if (t) setMsg({ ok: true, text: t }); } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    setBusy(false);
  };
  return { busy, msg, run };
}
const Msg = ({ m }: { m: { ok: boolean; text: string } | null }) => (m ? <p className={m.ok ? "okmsg small" : "err small"} role="status">{m.text}</p> : null);

export function CopyButton({ text, label = "Copy recap" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(text); } catch { /* ignore */ } setDone(true); setTimeout(() => setDone(false), 1500); }}>{done ? "Copied" : label}</button>;
}

export function TaskToggle({ id, done, title, children }: { id: string; done: boolean; title: string; children?: ReactNode }) {
  const router = useRouter();
  const [v, setV] = useState(done);
  return (
    <li className={v ? "done" : ""}>
      <input type="checkbox" checked={v} aria-label={`Mark done: ${title}`} onChange={async (e) => {
        const next = e.target.checked; setV(next);
        try { await call(`/api/tasks/${id}`, "PATCH", { done: next }); router.refresh(); } catch { setV(!next); }
      }} />
      <span className="t">{title}</span>{children}
    </li>
  );
}

export function ActionButtons({ id }: { id: string }) {
  const router = useRouter();
  const { busy, msg, run } = useBusy();
  const op = (o: "accept" | "snooze" | "dismiss") => run(async () => { await call(`/api/actions/${id}`, "POST", { op: o }); router.refresh(); });
  return (
    <div className="row" style={{ gap: ".4rem" }}>
      <button className="primary" disabled={busy} onClick={() => op("accept")}>Accept</button>
      <button disabled={busy} onClick={() => op("snooze")}>Snooze 7d</button>
      <button disabled={busy} onClick={() => op("dismiss")}>Dismiss</button>
      <Msg m={msg} />
    </div>
  );
}

export function KickoffForm({ accounts, accountId }: { accounts?: { id: string; name: string }[]; accountId?: string }) {
  const router = useRouter();
  const [acc, setAcc] = useState(accountId ?? accounts?.[0]?.id ?? "");
  const [text, setText] = useState("");
  const { busy, msg, run } = useBusy();
  const submit = (e: FormEvent) => { e.preventDefault(); run(async () => {
    const r = await call(`/api/accounts/${acc}/kickoff`, "POST", { transcript: text });
    setText("");
    router.push(`/accounts/${acc}#projects`); router.refresh();
    return `Created project with ${r.tasks.length} tasks and ${r.blockers.length} blocker(s).`;
  }); };
  return (
    <form onSubmit={submit}>
      {!accountId && (<><label htmlFor="kacc">Account</label><select id="kacc" value={acc} onChange={(e) => setAcc(e.target.value)}>{accounts?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></>)}
      <label htmlFor={`kt-${acc}`}>Kickoff call transcript (paste, or upload .txt/.md)</label>
      <textarea id={`kt-${acc}`} value={text} onChange={(e) => setText(e.target.value)} placeholder={"Name (Company, Role): text …"} required />
      <div className="row" style={{ marginTop: 6 }}>
        <input type="file" accept=".txt,.md,text/plain,text/markdown" aria-label="Upload transcript" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} />
        <button className="primary" disabled={busy || text.length < 40}>{busy ? "Planning…" : "Create onboarding project"}</button>
      </div>
      <Msg m={msg} />
    </form>
  );
}

export function UsageUpload({ accountId }: { accountId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const { busy, msg, run } = useBusy();
  return (
    <details>
      <summary>Ingest usage data (CSV)</summary>
      <label htmlFor="usage">week_start,active_users,metered_units,tickets_opened</label>
      <textarea id="usage" style={{ minHeight: 80 }} value={text} onChange={(e) => setText(e.target.value)} placeholder={"2026-11-09,30,6500,1"} />
      <div className="row" style={{ marginTop: 6 }}>
        <input type="file" accept=".csv,text/csv" aria-label="Upload CSV" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} />
        <button className="primary" disabled={busy || !text.trim()} onClick={() => run(async () => {
          const r = await call(`/api/accounts/${accountId}/usage`, "POST", undefined, text, "text/csv");
          router.refresh();
          return `Ingested ${r.ingested} rows; health now ${r.health?.score}; ${r.newActions.length} new action(s).`;
        })}>Ingest and re-analyze</button>
      </div>
      <Msg m={msg} />
    </details>
  );
}

export function BriefButton({ accountId }: { accountId: string }) {
  const router = useRouter();
  const { busy, msg, run } = useBusy();
  return (
    <div>
      <button className="primary" disabled={busy} onClick={() => run(async () => { await call(`/api/accounts/${accountId}/renewal-brief`, "POST", {}); router.refresh(); return "Brief drafted."; })}>{busy ? "Drafting…" : "Draft renewal brief"}</button>
      <Msg m={msg} />
    </div>
  );
}

interface Citation { n: number; kind: string; id: string; title: string; excerpt: string }
export function AskBox({ accountId }: { accountId: string }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<{ answer: string; citations: Citation[]; mode: string } | null>(null);
  const { busy, msg, run } = useBusy();
  const jump = (c: Citation) => { const el = document.getElementById(`item-${c.id}`); if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.style.outline = "2px solid var(--brand)"; setTimeout(() => (el.style.outline = ""), 1800); } };
  return (
    <div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); run(async () => { setRes(await call(`/api/accounts/${accountId}/ask`, "POST", { question: q })); }); }}>
        <input style={{ flex: 1, minWidth: 180 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Why did usage drop and what is the plan?" aria-label="Question" required />
        <button className="primary" disabled={busy || q.trim().length < 2}>{busy ? "Thinking…" : "Ask"}</button>
      </form>
      <Msg m={msg} />
      {res && (
        <div style={{ marginTop: 8 }}>
          <p>{res.answer}</p>
          <div className="chips">
            {res.citations.map((c) => (
              <a key={c.n} className="chip" href={`#item-${c.id}`} title={c.excerpt} onClick={() => jump(c)}>[{c.n}] {c.kind}: {c.title.slice(0, 40)}</a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function RadarForm() {
  const router = useRouter();
  const [f, setF] = useState({ title: "", text: "", source: "paste", url: "" });
  const { busy, msg, run } = useBusy();
  return (
    <form onSubmit={(e) => { e.preventDefault(); run(async () => {
      const r = await call("/api/radar", "POST", { title: f.title, text: f.text, source: f.source || "paste", ...(f.url ? { url: f.url } : {}) });
      setF({ title: "", text: "", source: "paste", url: "" }); router.refresh();
      return r.signal.relevant ? `Relevant (${r.signal.signalType}/${r.signal.direction}); ${r.actions.length} action(s) created.` : "Filtered out: no tracked account mentioned.";
    }); }}>
      <label htmlFor="rt">Headline</label>
      <input id="rt" style={{ width: "100%" }} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required />
      <label htmlFor="rx">Article text</label>
      <textarea id="rx" style={{ minHeight: 90 }} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} required />
      <div className="row" style={{ marginTop: 6 }}>
        <input aria-label="Source" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} placeholder="source" />
        <input aria-label="URL" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="url (optional)" />
        <button className="primary" disabled={busy}>{busy ? "Classifying…" : "Add to Radar"}</button>
      </div>
      <Msg m={msg} />
    </form>
  );
}

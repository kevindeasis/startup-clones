"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { CompileButton } from "../components/CompileButton";
import { SourceDrawer } from "../components/Markdown";

type Row = { id: number; title: string; kind: string; createdAt: string; compiledAt?: string; chars: number };
const kinds = ["markdown", "text", "email", "meeting", "slack", "csv"];

export default function Sources() {
  const [rows, setRows] = useState<Row[]>([]);
  const [view, setView] = useState<number | null>(null);
  const [form, setForm] = useState({ title: "", kind: "text", text: "" });
  const [msg, setMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => setRows(await (await fetch("/api/sources")).json()), []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Sources</h1>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={async () => { const j = await (await fetch("/api/sources/sample", { method: "POST" })).json(); setMsg(`Loaded ${j.added} sample sources.`); load(); }}>
            Load sample company
          </button>
          <CompileButton onDone={load} />
        </div>
      </div>
      {msg && <p className="text-sm text-slate-600">{msg}</p>}
      <div className="card space-y-3">
        <h2 className="font-semibold">Add a source</h2>
        <div className="flex gap-2">
          <input className="input" placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <select className="input !w-40" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            {kinds.map((k) => <option key={k}>{k}</option>)}
          </select>
        </div>
        <textarea className="input h-32 font-mono" placeholder="Paste meeting notes, an email thread, Slack export JSON [{user,text,ts}], CSV..." value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} />
        <div className="flex items-center gap-3">
          <button className="btn" disabled={!form.title || !form.text} onClick={async () => { await fetch("/api/sources", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) }); setForm({ title: "", kind: "text", text: "" }); load(); }}>
            Add pasted text
          </button>
          <span className="text-sm text-slate-500">or upload files (.md .txt .json .csv):</span>
          <input ref={fileRef} type="file" multiple accept=".md,.txt,.json,.csv,.eml" className="text-sm" onChange={async (e) => {
            const fd = new FormData();
            for (const f of Array.from(e.target.files ?? [])) fd.append("file", f);
            if (![...fd.keys()].length) return;
            await fetch("/api/sources", { method: "POST", body: fd });
            if (fileRef.current) fileRef.current.value = "";
            load();
          }} />
        </div>
      </div>
      <div className="card !p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left text-xs uppercase text-slate-500">
            <tr><th className="px-3 py-2">ID</th><th className="px-3 py-2">Title</th><th className="px-3 py-2">Kind</th><th className="px-3 py-2">Added</th><th className="px-3 py-2">Compiled</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-3 py-2">{r.id}</td>
                <td className="px-3 py-2"><button className="cursor-pointer text-left text-indigo-700 hover:underline" onClick={() => setView(r.id)}>{r.title}</button></td>
                <td className="px-3 py-2">{r.kind}</td>
                <td className="px-3 py-2">{new Date(r.createdAt).toLocaleDateString()}</td>
                <td className="px-3 py-2">{r.compiledAt ? "yes" : "pending"}</td>
                <td className="px-3 py-2 text-right"><button className="btn-ghost" onClick={async () => { await fetch(`/api/sources?id=${r.id}`, { method: "DELETE" }); load(); }}>Delete</button></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">No sources yet. Click &quot;Load sample company&quot; to start.</td></tr>}
          </tbody>
        </table>
      </div>
      <SourceDrawer id={view} onClose={() => setView(null)} />
    </div>
  );
}

"use client";
import { useEffect, useState } from "react";

type S = { id: string; slug: string; title: string; visibility: "private" | "public"; versions: number; updated_at: string };
const SAMPLES = [
  { file: "design-doc", label: "Design doc" },
  { file: "dashboard", label: "Dashboard with SVG chart" },
  { file: "landing-page", label: "Landing-page mockup" },
];

export default function Dashboard({ initial }: { initial: S[] }) {
  const [spaces, setSpaces] = useState<S[]>(initial);
  const [q, setQ] = useState("");
  const [title, setTitle] = useState("");
  const [html, setHtml] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function refresh(query = q) {
    const url = query.trim() ? `/api/search?q=${encodeURIComponent(query)}&all=1` : "/api/spaces";
    const r = await fetch(url);
    setSpaces(await r.json());
  }
  useEffect(() => { const t = setTimeout(() => refresh(q), 200); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [q]);

  async function create(t: string, h: string) {
    setBusy(true); setMsg("");
    try {
      // The browser form uses the dev key; the key is public in this clone.
      const r = await fetch("/api/spaces", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer dev-key" }, body: JSON.stringify({ title: t, html: h }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "failed");
      window.location.href = `/s/${d.slug}`;
    } catch (e: any) { setMsg(e.message); setBusy(false); }
  }
  async function sample(file: string, label: string) {
    const h = await (await fetch(`/samples/${file}.html`)).text();
    await create(label, h);
  }
  async function toggle(s: S) {
    const visibility = s.visibility === "public" ? "private" : "public";
    await fetch(`/api/spaces/${s.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ visibility }) });
    refresh();
  }
  async function copy(s: S) {
    const url = `${window.location.origin}/s/${s.slug}`;
    try { await navigator.clipboard.writeText(url); setMsg(`Copied ${url}`); } catch { setMsg(url); }
  }

  return (
    <main className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-semibold tracking-tight">Paddock</h1>
      <p className="text-stone-600 mt-1">A shared workspace for people and their AI agents. Independent learning clone of Spacesheep.</p>

      <section className="mt-8 grid gap-6 md:grid-cols-2">
        <div className="bg-white border border-stone-200 rounded-xl p-4">
          <h2 className="font-medium mb-3">New space</h2>
          <input aria-label="Title" className="w-full border rounded px-3 py-2 mb-2" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea aria-label="HTML" className="w-full border rounded px-3 py-2 h-24 font-mono text-xs" placeholder="Paste HTML" value={html} onChange={(e) => setHtml(e.target.value)} />
          <button disabled={busy || !title || !html} onClick={() => create(title, html)} className="mt-2 bg-stone-900 text-white rounded px-4 py-2 text-sm disabled:opacity-40">Create space</button>
          <div className="mt-4 text-sm text-stone-600">Or start from a sample:</div>
          <div className="flex flex-wrap gap-2 mt-2">
            {SAMPLES.map((s) => <button key={s.file} disabled={busy} onClick={() => sample(s.file, s.label)} className="border rounded px-3 py-1.5 text-sm hover:bg-stone-100">{s.label}</button>)}
          </div>
          {msg && <p className="text-sm text-red-700 mt-2" role="status">{msg}</p>}
        </div>
        <div className="bg-white border border-stone-200 rounded-xl p-4">
          <h2 className="font-medium mb-3">Publish from an agent</h2>
          <pre className="text-xs bg-stone-100 rounded p-3 overflow-x-auto">{`node scripts/deploy.mjs page.html --title "My page"\nclaude mcp add paddock -- node mcp/server.mjs`}</pre>
          <p className="text-sm text-stone-600 mt-2">Comment on a block with <code>@paddock make this shorter</code> to have the AI rewrite just that spot.</p>
        </div>
      </section>

      <section className="mt-8">
        <input aria-label="Search" className="w-full border rounded-lg px-3 py-2 bg-white" placeholder="Search spaces by title or content" value={q} onChange={(e) => setQ(e.target.value)} />
        <ul className="mt-4 divide-y bg-white border border-stone-200 rounded-xl">
          {spaces.length === 0 && <li className="p-4 text-stone-500 text-sm">No spaces yet. Create one above.</li>}
          {spaces.map((s) => (
            <li key={s.id} className="p-4 flex items-center gap-3 flex-wrap">
              <div className="flex-1 min-w-48">
                <a className="font-medium text-indigo-700 hover:underline" href={`/s/${s.slug}`}>{s.title}</a>
                <div className="text-xs text-stone-500">/{s.slug} · {s.versions} version{s.versions === 1 ? "" : "s"} · updated {new Date(s.updated_at).toLocaleString()}</div>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full ${s.visibility === "public" ? "bg-emerald-100 text-emerald-800" : "bg-stone-200 text-stone-700"}`}>{s.visibility}</span>
              <button onClick={() => toggle(s)} className="text-sm border rounded px-2 py-1 hover:bg-stone-100">Make {s.visibility === "public" ? "private" : "public"}</button>
              <button onClick={() => copy(s)} className="text-sm border rounded px-2 py-1 hover:bg-stone-100">Copy link</button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

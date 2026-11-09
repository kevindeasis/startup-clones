"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Markdown, SourceDrawer } from "./Markdown";
import type { WikiPage } from "@/lib/types";

type Item = Omit<WikiPage, "body">;
const groupName: Record<string, string> = { overview: "Overview", person: "People", project: "Projects", decisions: "Pages", "open-loops": "Pages", timeline: "Pages", glossary: "Pages" };

export function WikiView({ path }: { path?: string }) {
  const current = path ?? "overview.md";
  const [items, setItems] = useState<Item[]>([]);
  const [page, setPage] = useState<WikiPage | null>(null);
  const [missing, setMissing] = useState(false);
  const [cite, setCite] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setItems((await (await fetch("/api/wiki")).json()).pages);
    const r = await fetch(`/api/wiki/${current}`);
    if (r.ok) { setPage(await r.json()); setMissing(false); } else { setPage(null); setMissing(true); }
  }, [current]);
  useEffect(() => { setEditing(false); load(); }, [load]);

  const groups: Record<string, Item[]> = {};
  for (const i of items) (groups[groupName[i.kind]] ??= []).push(i);

  return (
    <div className="flex gap-6">
      <div className="w-56 shrink-0">
        <h1 className="mb-3 text-2xl font-semibold">Wiki</h1>
        {items.length === 0 && <p className="text-sm text-slate-500">No pages yet. Add sources and compile.</p>}
        {Object.entries(groups).map(([g, list]) => (
          <div key={g} className="mb-4">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{g}</div>
            {list.map((i) => (
              <Link key={i.path} href={`/wiki/${i.path}`} className={`block rounded px-2 py-1 text-sm hover:bg-slate-100 ${i.path === current ? "bg-indigo-100 font-medium text-indigo-800" : ""}`}>
                {i.title}{i.human_edited ? " *" : ""}
              </Link>
            ))}
          </div>
        ))}
      </div>
      <div className="card min-h-[24rem] min-w-0 flex-1 max-w-3xl">
        {missing && <p className="text-slate-500">Page not found. Compile the wiki to create pages.</p>}
        {page && (
          <>
            <div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-2 text-xs text-slate-500">
              <span>{page.path} · updated {new Date(page.updated).toLocaleString()}{page.human_edited ? " · human edited" : ""}</span>
              {editing ? (
                <span className="flex gap-2">
                  <button className="btn" disabled={saving} onClick={async () => {
                    setSaving(true);
                    await fetch(`/api/wiki/${page.path}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: draft }) });
                    setSaving(false); setEditing(false); load();
                  }}>Save</button>
                  <button className="btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
                </span>
              ) : (
                <button className="btn-ghost" onClick={() => { setDraft(page.body); setEditing(true); }}>Edit</button>
              )}
            </div>
            {editing ? (
              <textarea className="input h-[28rem] font-mono" value={draft} onChange={(e) => setDraft(e.target.value)} />
            ) : (
              <Markdown text={page.body} onCite={setCite} />
            )}
          </>
        )}
      </div>
      <SourceDrawer id={cite} onClose={() => setCite(null)} />
    </div>
  );
}

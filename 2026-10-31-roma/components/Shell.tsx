"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, type List } from "./api";

export default function Shell({ activeListId, active, children }: { activeListId?: string; active?: string; children: React.ReactNode }) {
  const router = useRouter();
  const [lists, setLists] = useState<List[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [fields, setFields] = useState("");

  const load = () => api<{ lists: List[] }>("/api/lists").then((r) => setLists(r.lists)).catch(() => {});
  useEffect(() => { load(); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const defs = fields.split(",").map((s) => s.trim()).filter(Boolean).map((n) => ({ name: n, type: "text" }));
    const l = await api<List>("/api/lists", { body: { name: name.trim(), kind: "custom", fields: defs } });
    setName(""); setFields(""); setAdding(false);
    router.push(`/lists/${l.id}`);
  }

  const link = (href: string, label: string, on: boolean) => (
    <Link href={href} className={`block rounded px-3 py-1.5 text-sm ${on ? "bg-stone-900 text-white" : "hover:bg-stone-200"}`}>{label}</Link>
  );

  return (
    <div className="flex min-h-screen flex-col md:h-screen md:flex-row">
      <aside className="w-full shrink-0 border-b border-stone-200 bg-stone-100 p-3 md:w-56 md:overflow-y-auto md:border-b-0 md:border-r">
        <Link href="/" className="mb-3 block text-lg font-semibold tracking-tight">Roma <span className="text-xs font-normal text-stone-500">clone</span></Link>
        <nav className="flex flex-wrap gap-1 md:block md:space-y-0.5">
          {lists.map((l) => <div key={l.id}>{link(`/lists/${l.id}`, l.name, activeListId === l.id)}</div>)}
          <div className="my-1 hidden border-t border-stone-300 md:block" />
          {link("/trash", "Trash", active === "trash")}
          {link("/outbox", "Outbox", active === "outbox")}
          {link("/automations", "Automations", active === "automations")}
        </nav>
        {adding ? (
          <form onSubmit={create} className="mt-3 space-y-1">
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="List name" className="w-full rounded border border-stone-300 px-2 py-1 text-sm" />
            <input value={fields} onChange={(e) => setFields(e.target.value)} placeholder="Fields: author, rating" className="w-full rounded border border-stone-300 px-2 py-1 text-sm" />
            <div className="flex gap-1">
              <button className="rounded bg-stone-900 px-2 py-1 text-xs text-white">Create</button>
              <button type="button" onClick={() => setAdding(false)} className="px-2 py-1 text-xs">Cancel</button>
            </div>
          </form>
        ) : (
          <button onClick={() => setAdding(true)} className="mt-3 w-full rounded border border-dashed border-stone-400 px-3 py-1.5 text-left text-sm text-stone-600 hover:bg-stone-200">+ New list</button>
        )}
        <p className="mt-4 hidden text-[10px] leading-snug text-stone-400 md:block">Unofficial learning clone. Not affiliated with Roma.</p>
      </aside>
      <main className="min-w-0 flex-1 md:overflow-y-auto">{children}</main>
    </div>
  );
}

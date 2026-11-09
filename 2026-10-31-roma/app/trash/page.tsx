"use client";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { api, type Item } from "@/components/api";

export default function Trash() {
  const [items, setItems] = useState<Item[]>([]);
  const load = () => api<{ items: Item[] }>("/api/items?onlyDeleted=1&includeDeleted=1").then((r) => setItems(r.items));
  useEffect(() => { load(); }, []);
  return (
    <Shell active="trash">
      <div className="p-4">
        <h1 className="mb-1 text-xl font-semibold">Trash</h1>
        <p className="mb-3 text-sm text-stone-500">Deleted items can be restored for 30 days.</p>
        <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
          {items.length === 0 && <li className="p-4 text-sm text-stone-500">Trash is empty.</li>}
          {items.map((it) => (
            <li key={it.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{it.title}</span>
              <span className="text-xs text-stone-500">{it.deletedAt?.slice(0, 10)}</span>
              <button onClick={async () => { await api(`/api/items/${it.id}/restore`, { method: "POST" }); load(); }} className="rounded border border-stone-300 px-2 py-1">Restore</button>
            </li>
          ))}
        </ul>
      </div>
    </Shell>
  );
}

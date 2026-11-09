"use client";
import { useCallback, useEffect, useState } from "react";
import { api, type Item, type List } from "./api";
import Chat from "./Chat";
import ItemPanel from "./ItemPanel";
import Shell from "./Shell";

export default function Workspace({ listId }: { listId?: string }) {
  const [lists, setLists] = useState<List[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [curId, setCurId] = useState<string | undefined>(listId);
  const [tick, setTick] = useState(0);

  useEffect(() => { api<{ lists: List[] }>("/api/lists").then((r) => {
    setLists(r.lists);
    if (!listId) setCurId(r.lists.find((l) => l.kind === "tasks")?.id ?? r.lists[0]?.id);
  }); }, [listId, tick]);
  useEffect(() => { if (curId) api<{ items: Item[] }>(`/api/items?listId=${curId}`).then((r) => setItems(r.items)); }, [curId, tick]);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const cur = lists.find((l) => l.id === curId);
  const today = new Date().toLocaleDateString("en-CA");

  async function toggle(it: Item) {
    await api(`/api/items/${it.id}`, { method: "PATCH", body: { checked: !it.checked } });
    refresh();
  }
  async function quickAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim() || !curId) return;
    await api("/api/items", { body: { title: newTitle.trim(), listId: curId, kind: cur?.kind === "notes" ? "note" : "task" } });
    setNewTitle(""); refresh();
  }

  return (
    <Shell activeListId={curId}>
      <div className="flex min-h-full flex-col md:h-full md:flex-row">
        <section className="min-w-0 flex-1 p-4 md:overflow-y-auto">
          <h1 className="mb-3 text-xl font-semibold">{cur?.name ?? "..."}</h1>
          <form onSubmit={quickAdd} className="mb-3">
            <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Add manually..." className="w-full rounded border border-stone-300 bg-white px-3 py-2 text-sm" />
          </form>
          <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white" data-testid="items">
            {items.length === 0 && <li className="p-4 text-sm text-stone-500">Nothing here yet. Tell the operator what you need.</li>}
            {items.map((it) => (
              <li key={it.id} className="flex items-center gap-3 px-3 py-2">
                <input type="checkbox" checked={it.checked} onChange={() => toggle(it)} className="h-4 w-4" aria-label={`Check ${it.title}`} />
                <button onClick={() => setOpen(it.id)} className={`min-w-0 flex-1 truncate text-left text-sm ${it.checked ? "text-stone-400 line-through" : ""}`}>{it.title}</button>
                {it.dueDate && (
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${!it.checked && it.dueDate < today ? "bg-red-100 text-red-700" : it.dueDate === today ? "bg-amber-100 text-amber-800" : "bg-stone-100 text-stone-600"}`}>
                    {it.dueDate === today ? "Today" : it.dueDate}{it.dueTime ? " " + it.dueTime : ""}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
        <section className="h-[28rem] border-t border-stone-200 bg-stone-50 md:h-auto md:w-96 md:border-l md:border-t-0">
          <Chat onChange={refresh} />
        </section>
      </div>
      {open && <ItemPanel itemId={open} lists={lists} onClose={() => setOpen(null)} onChange={refresh} />}
    </Shell>
  );
}

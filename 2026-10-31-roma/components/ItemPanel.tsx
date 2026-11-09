"use client";
import { useEffect, useState } from "react";
import { api, type Item, type List } from "./api";
import Chat from "./Chat";

export default function ItemPanel({ itemId, lists, onClose, onChange }: { itemId: string; lists: List[]; onClose: () => void; onChange: () => void }) {
  const [item, setItem] = useState<Item | null>(null);
  const load = () => api<Item>(`/api/items/${itemId}`).then(setItem).catch(() => setItem(null));
  useEffect(() => { load(); }, [itemId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function patch(p: Partial<Item>) {
    const r = await api<Item>(`/api/items/${itemId}`, { method: "PATCH", body: p });
    setItem(r); onChange();
  }
  async function del() {
    await api(`/api/items/${itemId}`, { method: "DELETE" });
    onChange(); onClose();
  }
  if (!item) return null;
  const list = lists.find((l) => l.id === item.listId);

  return (
    <div className="fixed inset-0 z-20 flex justify-end bg-black/30" onClick={onClose}>
      <div className="flex h-full w-full max-w-lg flex-col bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-stone-200 px-4 py-2">
          <span className="text-sm text-stone-500">{item.kind === "note" ? "Note" : "Task"}</span>
          <button onClick={onClose} className="text-sm">Close</button>
        </div>
        <div className="space-y-2 overflow-y-auto border-b border-stone-200 p-4">
          <input defaultValue={item.title} onBlur={(e) => e.target.value !== item.title && patch({ title: e.target.value })} className="w-full rounded border border-stone-200 px-2 py-1 text-lg font-medium" aria-label="Title" />
          <div className="flex flex-wrap gap-2 text-sm">
            <input type="date" defaultValue={item.dueDate ?? ""} onChange={(e) => patch({ dueDate: e.target.value || null })} className="rounded border border-stone-300 px-2 py-1" aria-label="Due date" />
            <input type="time" defaultValue={item.dueTime ?? ""} onChange={(e) => patch({ dueTime: e.target.value || null })} className="rounded border border-stone-300 px-2 py-1" aria-label="Due time" />
            <select value={item.listId} onChange={(e) => patch({ listId: e.target.value })} className="rounded border border-stone-300 px-2 py-1" aria-label="List">
              {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <button onClick={del} className="ml-auto rounded border border-red-300 px-2 py-1 text-red-700">Delete</button>
          </div>
          {list?.fields.map((f) => (
            <label key={f.name} className="flex items-center gap-2 text-sm"><span className="w-24 text-stone-500">{f.name}</span>
              <input defaultValue={String(item.fields[f.name] ?? "")} onBlur={(e) => patch({ fields: { [f.name]: e.target.value } })} className="flex-1 rounded border border-stone-300 px-2 py-1" />
            </label>
          ))}
          <textarea key={item.body} defaultValue={item.body} rows={6} onBlur={(e) => e.target.value !== item.body && patch({ body: e.target.value })} placeholder="Notes (markdown)" className="w-full rounded border border-stone-300 px-2 py-1 text-sm" aria-label="Body" />
        </div>
        <div className="min-h-0 flex-1">
          <Chat itemId={itemId} onChange={() => { load(); onChange(); }} placeholder="Chat about this item..." />
        </div>
      </div>
    </div>
  );
}

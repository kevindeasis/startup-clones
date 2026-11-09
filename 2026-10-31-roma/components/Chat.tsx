"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Approval, type Item, type Msg } from "./api";

function ApprovalCard({ a, onDone }: { a: Approval; onDone: () => void }) {
  const [status, setStatus] = useState(a.status);
  async function act(kind: "approve" | "reject") {
    const r = await api<Approval>(`/api/approvals/${a.id}/${kind}`, { method: "POST" });
    setStatus(r.status); onDone();
  }
  const p = a.payload as Record<string, unknown>;
  return (
    <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm" data-testid="approval-card">
      <div className="font-medium">{a.kind === "send_email" ? "Send email?" : a.kind === "delete_items" ? "Delete items?" : "Apply bulk change?"}</div>
      {a.kind === "send_email" && <div className="mt-1 text-stone-700"><div>To: {String(p.to)}</div><div>Subject: {String(p.subject)}</div><pre className="mt-1 whitespace-pre-wrap font-sans text-xs">{String(p.body)}</pre></div>}
      {a.kind === "delete_items" && <ul className="mt-1 list-disc pl-5 text-stone-700">{((p.titles as string[]) ?? []).map((t, i) => <li key={i}>{t}</li>)}</ul>}
      {a.kind === "bulk_update" && <div className="mt-1 text-stone-700">{((p.updates as unknown[]) ?? []).length} updates</div>}
      {status === "pending" ? (
        <div className="mt-2 flex gap-2">
          <button onClick={() => act("approve")} className="rounded bg-emerald-600 px-3 py-1 text-white">Approve</button>
          <button onClick={() => act("reject")} className="rounded border border-stone-300 bg-white px-3 py-1">Reject</button>
        </div>
      ) : <div className="mt-2 text-xs font-medium uppercase text-stone-500">{status}</div>}
    </div>
  );
}

export default function Chat({ itemId, onChange, placeholder }: { itemId?: string; onChange: () => void; placeholder?: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [mock, setMock] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  const load = useCallback(() => api<{ mock: boolean; messages: Msg[] }>(`/api/operator${itemId ? `?itemId=${itemId}` : ""}`).then((r) => { setMsgs(r.messages); setMock(r.mock); }).catch(() => {}), [itemId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs, busy]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const m = text.trim();
    if (!m || busy) return;
    setText(""); setBusy(true);
    setMsgs((x) => [...x, { id: "tmp", role: "user", content: m }]);
    try { await api("/api/operator", { body: { message: m, itemId } }); } catch (err) { alert(String(err)); }
    await load(); setBusy(false); onChange();
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {mock && <div className="bg-stone-200 px-3 py-1 text-[11px] text-stone-600">Mock operator (no API key): rule-based, deterministic.</div>}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {msgs.length === 0 && <p className="text-sm text-stone-500">{itemId ? "Ask me to research, draft, or rewrite this item." : "Try: call the dentist tomorrow, buy milk on friday, and what is the capital of Peru?"}</p>}
        {msgs.map((m) => (
          <div key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
            <div className={`max-w-[92%] rounded-lg px-3 py-2 text-sm ${m.role === "user" ? "bg-stone-900 text-white" : "border border-stone-200 bg-white"}`}>
              <div className="whitespace-pre-wrap break-words">{m.content}</div>
              {m.createdItems?.map((it: Item) => (
                <div key={it.id} className="mt-2 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs">
                  <span className="font-medium">{it.kind === "note" ? "Note" : "Task"}:</span> {it.title}{it.dueDate && <span className="ml-1 text-stone-500">({it.dueDate}{it.dueTime ? " " + it.dueTime : ""})</span>}
                </div>
              ))}
              {m.approvals?.map((a) => <ApprovalCard key={a.id} a={a} onDone={onChange} />)}
            </div>
          </div>
        ))}
        {busy && <div className="text-sm text-stone-500">Thinking...</div>}
        <div ref={end} />
      </div>
      <form onSubmit={send} className="flex gap-2 border-t border-stone-200 p-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder ?? "Tell Roma anything..."} className="min-w-0 flex-1 rounded border border-stone-300 bg-white px-3 py-2 text-sm" />
        <button disabled={busy} className="rounded bg-stone-900 px-4 py-2 text-sm text-white disabled:opacity-50">Send</button>
      </form>
    </div>
  );
}

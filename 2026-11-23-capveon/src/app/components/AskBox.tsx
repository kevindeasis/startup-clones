"use client";
import Link from "next/link";
import { useState } from "react";

interface Citation { page: number; quote: string; documentId?: string }

export function AskBox({ documentId }: { documentId: string }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ answer: string; citations: Citation[] } | null>(null);
  const [err, setErr] = useState("");

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const r = await fetch(`/api/documents/${documentId}/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q }) });
    const data = await r.json();
    if (!r.ok) setErr(data.error ?? "Failed");
    else setRes(data);
    setBusy(false);
  }

  return (
    <div className="card">
      <form onSubmit={ask} style={{ display: "flex", gap: 8 }}>
        <input style={{ flex: 1 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about this bid, e.g. When are bids due?" required minLength={2} />
        <button disabled={busy}>{busy ? "Asking..." : "Ask"}</button>
      </form>
      {err && <p className="err">{err}</p>}
      {res && (
        <div style={{ marginTop: 10 }}>
          <div>{res.answer}</div>
          {res.citations.length > 0 && (
            <div className="src">
              {res.citations.map((c, i) => (
                <div key={i}>
                  <Link href={`/documents/${c.documentId ?? documentId}?page=${c.page}`}>[p.{c.page}]</Link> &ldquo;{c.quote}&rdquo;
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

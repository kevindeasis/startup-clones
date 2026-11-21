"use client";
import { useState } from "react";
import { AnswerView, type AnswerCitationView } from "./AnswerView";

export function AskBox({ obligorId, obligorName }: { obligorId: string; obligorName: string }) {
  const [q, setQ] = useState("What is the latest days cash on hand and how has it changed?");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [res, setRes] = useState<{ answer: string; citations: AnswerCitationView[]; mode: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const r = await fetch(`/api/obligors/${obligorId}/ask`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Request failed");
      setRes(j);
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="stack" aria-label={`Ask about ${obligorName}`}>
      <textarea value={q} onChange={(e) => setQ(e.target.value)} rows={2} aria-label="Question" />
      <div className="row">
        <button type="submit" disabled={busy || q.trim().length < 3}>
          {busy ? "Asking..." : "Ask"}
        </button>
        {res && <span className={`badge mode-${res.mode}`}>{res.mode}</span>}
      </div>
      {err && <div className="error">{err}</div>}
      {res && <AnswerView answer={res.answer} citations={res.citations} />}
    </form>
  );
}

"use client";
import { useState } from "react";
import { AnswerView, type AnswerCitationView } from "./AnswerView";

type Result = { obligorId: string; obligorName: string; answer: string; citations: AnswerCitationView[] };

export function AskCompare({ obligors }: { obligors: { id: string; name: string }[] }) {
  const [a, setA] = useState(obligors[0]?.id ?? "");
  const [b, setB] = useState("");
  const [q, setQ] = useState("What is the days cash on hand and the debt service coverage?");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [res, setRes] = useState<{ results: Result[]; mode: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const ids = b && b !== a ? [a, b] : [a];
      const r = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q, obligorIds: ids }) });
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
    <div className="stack">
      <form onSubmit={submit} className="stack" aria-label="Ask question">
        <div className="grid2">
          <label>
            Obligor
            <select value={a} onChange={(e) => setA(e.target.value)} aria-label="First obligor">
              {obligors.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Compare with (optional)
            <select value={b} onChange={(e) => setB(e.target.value)} aria-label="Second obligor">
              <option value="">None</option>
              {obligors
                .filter((o) => o.id !== a)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <textarea value={q} onChange={(e) => setQ(e.target.value)} rows={2} aria-label="Question" />
        <div className="row">
          <button type="submit" disabled={busy || q.trim().length < 3}>
            {busy ? "Asking..." : "Ask"}
          </button>
          {res && <span className={`badge mode-${res.mode}`}>{res.mode}</span>}
        </div>
      </form>
      {err && <div className="error">{err}</div>}
      {res && (
        <div className="grid2 compare">
          {res.results.map((r) => (
            <section key={r.obligorId} className="panel" aria-label={`Answer for ${r.obligorName}`}>
              <h3>{r.obligorName}</h3>
              <AnswerView answer={r.answer} citations={r.citations} />
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

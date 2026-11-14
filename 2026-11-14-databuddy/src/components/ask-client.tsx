"use client";

import { useState } from "react";
import { ResultChart } from "./charts";
import { Markdown } from "./markdown";
import { Button, Card, inputClass } from "./ui";
import { useFetch } from "./use-fetch";
import type { AskResult } from "@/lib/types";

type Entry = AskResult & { question: string };

const SUGGESTIONS = [
  "What were my top 5 pages last week?",
  "Which referrers brought the most signups in the last 30 days?",
  "How many visitors did I get per day in the last 30 days?",
  "Which countries do my visitors come from?",
  "Which JS errors happen most often?",
  "What browsers do my visitors use?",
];

function ResultCard({ entry }: { entry: Entry }) {
  const rows = entry.rows.slice(0, 50);
  return (
    <Card>
      <p className="mb-2 text-sm font-semibold">{entry.question}</p>
      <Markdown text={entry.answer_md} />
      {entry.sql && (
        <details open className="mt-3 rounded-lg border border-[var(--line)]" data-testid="sql-block">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Query Bunny ran</summary>
          <pre className="overflow-x-auto bg-zinc-900 p-3 text-xs text-zinc-100">{entry.sql}</pre>
          <p className="px-3 py-1 text-xs text-[var(--muted)]">:site is bound to this site&apos;s id. Read-only connection, LIMIT 200.</p>
        </details>
      )}
      {entry.chart && rows.length > 0 && <div className="mt-3"><ResultChart chart={entry.chart} rows={rows} /></div>}
      {rows.length > 0 && (
        <div className="mt-3 max-h-80 overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[var(--muted)]"><tr>{entry.columns.map((c) => <th key={c} className="pr-4">{c}</th>)}</tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-[var(--line)]">{entry.columns.map((c) => <td key={c} className="py-1 pr-4">{String(r[c] ?? "")}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-[var(--muted)]">mode: {entry.mode}</p>
    </Card>
  );
}

export function AskClient({ siteId }: { siteId: string }) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [latest, setLatest] = useState<Entry | null>(null);
  const history = useFetch<Entry[]>(`/api/sites/${siteId}/ask`);

  async function submit(q: string) {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/sites/${siteId}/ask`, { method: "POST", body: JSON.stringify({ question: q }) });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) return setError(body.error);
    setLatest({ ...body, question: q });
    history.reload();
  }

  return (
    <div className="space-y-4">
      <Card>
        <form onSubmit={(e) => { e.preventDefault(); void submit(question); }} className="flex gap-2">
          <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask Bunny about your traffic..." aria-label="Question" className={`${inputClass} flex-1`} />
          <Button type="submit" disabled={busy || question.trim().length < 3}>{busy ? "Thinking..." : "Ask"}</Button>
        </form>
        <div className="mt-3 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => { setQuestion(s); void submit(s); }} disabled={busy} className="rounded-full border border-[var(--line)] px-3 py-1 text-xs hover:border-[var(--accent)]">{s}</button>
          ))}
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </Card>
      {latest && <ResultCard entry={latest} />}
      {history.data && history.data.some((h) => h.id !== latest?.id) && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-[var(--muted)]">History</h2>
          {history.data.filter((h) => h.id !== latest?.id).map((h) => <ResultCard key={h.id} entry={h} />)}
        </div>
      )}
    </div>
  );
}

"use client";
import Link from "next/link";
import { useState } from "react";

interface Attempt { text: string; verdict: "landed" | "okay" | "backfired"; note: string; modelAnswer: string }
const MAX = 3;

export function DrillClient({ sessionId, lineIndex, partnerLine, weakLine, reason, initialAttempts, initialDone }: {
  sessionId: string; lineIndex: number; partnerLine: string; weakLine: string; reason: string; initialAttempts: Attempt[]; initialDone: boolean;
}) {
  const [attempts, setAttempts] = useState(initialAttempts);
  const [done, setDone] = useState(initialDone);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const last = attempts[attempts.length - 1];

  async function call(payload: object) {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/sessions/${sessionId}/drill`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lineIndex, ...payload }) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Something went wrong");
    setAttempts(data.drill.attempts);
    setDone(data.drill.done);
    setText("");
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2 text-sm">
        <p className="rounded-lg bg-stone-200 p-3 dark:bg-stone-800"><span className="block text-xs opacity-70">They said</span>{partnerLine}</p>
        <p className="rounded-lg bg-indigo-600 p-3 text-white"><span className="block text-xs opacity-70">You said</span>{weakLine}</p>
        <p className="text-stone-600 dark:text-stone-400">Why it was weak: {reason}</p>
      </div>
      {attempts.map((a, i) => (
        <div key={i} className="rounded-lg border border-stone-300 p-3 text-sm dark:border-stone-700">
          <p>Attempt {i + 1}: {a.text}</p>
          <p className="mt-1"><strong data-testid="verdict">{a.verdict}</strong>: {a.note}</p>
          {(done || i < attempts.length - 1) && <p className="mt-1 text-stone-600 dark:text-stone-400">Model answer: {a.modelAnswer}</p>}
        </div>
      ))}
      {done ? (
        <div className="space-y-2">
          <p className="font-medium text-emerald-700 dark:text-emerald-300">{last?.verdict === "landed" ? "Drill complete: that one landed." : "Drill finished."}</p>
          {last && <p className="text-sm">Model answer: {last.modelAnswer}</p>}
          <Link href="/" className="inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white">Back to curriculum</Link>
        </div>
      ) : (
        <div className="space-y-2">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={1000} placeholder="Rewrite your line..."
            className="w-full rounded-lg border border-stone-300 bg-white p-3 text-sm dark:border-stone-700 dark:bg-stone-900" />
          <div className="flex items-center gap-3">
            <button onClick={() => call({ attempt: text })} disabled={busy || !text.trim()} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? "Grading..." : "Submit"}</button>
            <button onClick={() => call({ giveUp: true })} disabled={busy} className="text-sm text-stone-500 underline">Give up</button>
            <span className="text-xs text-stone-500">{MAX - attempts.length} attempt{MAX - attempts.length === 1 ? "" : "s"} left</span>
          </div>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

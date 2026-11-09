"use client";
import { useState } from "react";
import { QUIZ } from "@/lib/quiz";

interface Result { score: number; band: string; narrative: string; fixes: string[]; disclaimer: string }

export default function QuizClient() {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const complete = QUIZ.every((q) => answers[q.id]);

  async function submit() {
    setBusy(true); setError("");
    const res = await fetch("/api/quiz", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ answers }) });
    const data = await res.json();
    if (res.ok) setResult(data); else setError(data.error);
    setBusy(false);
  }

  if (result) {
    return (
      <div className="card mx-auto max-w-2xl space-y-4">
        <h1 className="text-2xl font-bold">Your result</h1>
        <div className="text-5xl font-bold text-indigo-700">{result.score}<span className="text-xl text-slate-400">/100</span> <span className="text-xl">{result.band}</span></div>
        <p>{result.narrative}</p>
        <h2 className="font-semibold">Top fixes</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm">{result.fixes.map((f) => <li key={f}>{f}</li>)}</ol>
        <p className="text-sm font-medium text-slate-600">{result.disclaimer} Nothing here is stored.</p>
        <button className="btn-secondary" onClick={() => { setResult(null); setAnswers({}); }}>Retake</button>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <h1 className="text-2xl font-bold">How strong is your visa application?</h1>
      <p className="text-sm text-slate-600">{QUIZ.length} quick questions. No login, nothing is saved. A guide, never a visa decision.</p>
      {QUIZ.map((q, i) => (
        <fieldset key={q.id} className="card">
          <legend className="px-1 font-medium">{i + 1}. {q.text}</legend>
          <div className="mt-2 space-y-1">
            {q.options.map((o) => (
              <label key={o.id} className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="radio" name={q.id} checked={answers[q.id] === o.id} onChange={() => setAnswers({ ...answers, [q.id]: o.id })} />
                {o.label}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button className="btn" disabled={!complete || busy} onClick={submit}>{busy ? "Scoring..." : "See my score"}</button>
    </div>
  );
}

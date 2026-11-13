"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AREAS, AREA_LABELS } from "../lib/schemas";
import { useInterviewChat } from "./useInterviewChat";
import { useSpeech } from "./useSpeech";

export default function InterviewClient({ token }: { token: string }) {
  const [input, setInput] = useState("");
  const [readAloud, setReadAloud] = useState(false);
  const { state, streaming, error, send, finish } = useInterviewChat(token);
  const speech = useSpeech(useCallback((t: string) => setInput((v) => `${v} ${t}`.trim()), []));
  const { speak } = speech;
  const bottom = useRef<HTMLDivElement>(null);

  const lastMessage = state?.messages.at(-1);
  useEffect(() => {
    if (readAloud && !streaming && lastMessage?.role === "assistant" && lastMessage.content) speak(lastMessage.content);
  }, [readAloud, streaming, lastMessage, speak]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [state?.messages]);

  if (error && !state) return <p className="p-8 text-red-600">{error}</p>;
  if (!state) return <p className="p-8 text-slate-500">Loading…</p>;

  const userTurns = state.messages.filter((m) => m.role === "user").length;
  const allCovered = AREAS.every((a) => state.coverage.includes(a));
  const canFinish = userTurns >= 6 || allCovered;

  if (state.participant.status === "completed" && state.extraction) {
    const e = state.extraction;
    return (
      <div className="mx-auto max-w-xl p-8">
        <h1 className="mb-2 text-2xl font-semibold">Thank you!</h1>
        <p className="mb-4 text-slate-600">Your interview is complete. Here is what we captured:</p>
        <p className="mb-3 rounded border bg-white p-4 text-sm">{e.summary}</p>
        <ul className="list-disc pl-5 text-sm">{e.steps.map((s) => <li key={s.id}>{s.name}</li>)}</ul>
      </div>
    );
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    await send(text);
  }

  return (
    <div className="mx-auto grid h-screen max-w-5xl gap-4 p-4 md:grid-cols-[1fr_16rem]">
      <section className="flex min-h-0 flex-col rounded border bg-white">
        <header className="border-b p-3">
          <div className="font-medium">{state.study.title}</div>
          <div className="text-xs text-slate-500">{state.study.topic}</div>
        </header>
        <div className="flex-1 space-y-3 overflow-auto p-3" data-testid="messages">
          {state.messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "text-right" : ""}>
              <span className={`inline-block max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.role === "user" ? "bg-indigo-600 text-white" : "bg-slate-100"}`}>{m.content || "…"}</span>
            </div>
          ))}
          <div ref={bottom} />
        </div>
        {error && <p className="px-3 text-sm text-red-600">{error}</p>}
        <form onSubmit={submit} className="flex gap-2 border-t p-3">
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type your answer…" className="flex-1 rounded border px-3 py-2 text-sm" />
          {speech.micSupported && (
            <button type="button" onClick={speech.toggleMic} className={`rounded border px-3 text-sm ${speech.listening ? "bg-red-100" : ""}`}>{speech.listening ? "Stop" : "Mic"}</button>
          )}
          <button disabled={streaming || !input.trim()} className="rounded bg-slate-900 px-4 text-sm text-white disabled:opacity-50">Send</button>
        </form>
      </section>
      <aside className="space-y-4 rounded border bg-white p-4 text-sm">
        <div>
          <h2 className="mb-2 font-medium">Coverage</h2>
          <ul className="space-y-1">
            {AREAS.map((a) => (
              <li key={a} className={state.coverage.includes(a) ? "text-green-700" : "text-slate-400"}>
                {state.coverage.includes(a) ? "☑" : "☐"} {AREA_LABELS[a]}
              </li>
            ))}
          </ul>
        </div>
        {speech.ttsSupported && (
          <label className="flex items-center gap-2"><input type="checkbox" checked={readAloud} onChange={(e) => setReadAloud(e.target.checked)} /> Read questions aloud</label>
        )}
        <button onClick={finish} disabled={!canFinish || streaming} className="w-full rounded bg-green-600 px-3 py-2 text-white disabled:opacity-40">Finish interview</button>
        {!canFinish && <p className="text-xs text-slate-500">Available after 6 answers or when every area is covered ({userTurns}/6).</p>}
      </aside>
    </div>
  );
}

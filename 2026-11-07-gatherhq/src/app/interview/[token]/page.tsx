"use client";
import { use, useEffect, useRef, useState } from "react";

type Msg = { role: "assistant" | "user"; content: string };

export default function InterviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [title, setTitle] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [done, setDone] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/interviews/${token}/messages`);
      if (!res.ok) return setError("This interview link is not valid.");
      const d = await res.json();
      setTitle(d.study.title);
      setMsgs(d.messages);
      if (d.status === "complete") return setDone(true);
      if (d.messages.length === 0) {
        setBusy(true);
        const r = await fetch(`/api/interviews/${token}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
        const j = await r.json();
        setMsgs([{ role: "assistant", content: j.message }]);
        setBusy(false);
      }
    })();
  }, [token]);

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const content = text.trim();
    if (!content || busy || done) return;
    setText(""); setBusy(true);
    setMsgs((m) => [...m, { role: "user", content }]);
    const r = await fetch(`/api/interviews/${token}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content }) });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) return setError(j.error || "Something went wrong");
    if (j.message) setMsgs((m) => [...m, { role: "assistant", content: j.message }]);
    if (j.done) setDone(true);
  }

  if (error) return <p className="text-red-600">{error}</p>;
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-xl font-semibold">{title || "Interview"}</h1>
      <p className="mb-4 text-sm text-stone-500">A short conversation with an AI researcher. Your answers are recorded for this study.</p>
      <div className="space-y-3 rounded-lg border border-stone-200 p-4 dark:border-stone-800" data-testid="chat">
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${m.role === "user" ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900" : "bg-stone-100 dark:bg-stone-800"}`}>
              {m.content}
            </div>
          </div>
        ))}
        {busy && <div className="text-sm text-stone-400">...</div>}
        <div ref={bottom} />
      </div>
      {done ? (
        <p className="mt-4 rounded-md bg-green-100 p-3 text-sm text-green-900">Interview complete. Thank you!</p>
      ) : (
        <form onSubmit={send} className="mt-4 flex gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type your answer..." className="flex-1 rounded-md border border-stone-300 bg-transparent px-3 py-2 text-sm dark:border-stone-700" />
          <button disabled={busy || !text.trim()} className="rounded-md bg-stone-900 px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900">Send</button>
        </form>
      )}
    </div>
  );
}

"use client";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

const SENTINEL = "[The scene begins. Say your opening line.]";
const MAX_LINES = 6;

interface Props {
  sessionId: string;
  scenario: { title: string; character: string; persona: string; setting: string; goal: string; stakes: string };
  initial: { role: "user" | "partner"; text: string }[];
  focus?: string | null;
}

type SpeechRec = { lang: string; interimResults: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null; start(): void; stop(): void };

const textOf = (m: UIMessage) => m.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("");

export function Practice({ sessionId, scenario, initial, focus }: Props) {
  const router = useRouter();
  const transport = useMemo(() => new DefaultChatTransport({ api: "/api/chat", body: { sessionId } }), [sessionId]);
  const seed: UIMessage[] = useMemo(
    () => initial.map((m, i) => ({ id: "init-" + i, role: m.role === "user" ? ("user" as const) : ("assistant" as const), parts: [{ type: "text" as const, text: m.text }] })),
    [initial],
  );
  const { messages, sendMessage, status, error } = useChat({ transport, messages: seed });
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState("");
  const started = useRef(false);
  const recRef = useRef<SpeechRec | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const [speechOk] = useState(() => typeof window !== "undefined" && ("webkitSpeechRecognition" in window || "SpeechRecognition" in window));

  const visible = messages.filter((m) => !(m.role === "user" && textOf(m) === SENTINEL));
  const userCount = visible.filter((m) => m.role === "user").length;
  const busy = status === "submitted" || status === "streaming";
  const full = userCount >= MAX_LINES;

  useEffect(() => {
    if (started.current || initial.length > 0) return;
    started.current = true;
    sendMessage({ text: SENTINEL });
  }, [initial.length, sendMessage]);

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, status]);

  async function endSession() {
    if (ending) return;
    setEnding(true);
    setEndError("");
    const res = await fetch(`/api/sessions/${sessionId}/feedback`, { method: "POST" });
    if (!res.ok) {
      setEndError((await res.json().catch(() => ({}))).error ?? "Could not get feedback");
      setEnding(false);
      return;
    }
    router.push(`/session/${sessionId}/feedback`);
  }

  const autoEnded = useRef(false);
  useEffect(() => {
    if (full && status === "ready" && visible[visible.length - 1]?.role === "assistant" && !autoEnded.current) {
      autoEnded.current = true;
      endSession();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full, status, visible.length]);

  function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy || full) return;
    setInput("");
    sendMessage({ text });
  }

  function toggleMic() {
    if (listening) { recRef.current?.stop(); return; }
    const w = window as unknown as { webkitSpeechRecognition?: new () => SpeechRec; SpeechRecognition?: new () => SpeechRec };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.onresult = (e) => {
      const t = Array.from(e.results).map((r) => r[0].transcript).join(" ");
      setInput((prev) => (prev ? prev + " " : "") + t);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-stone-300 p-3 text-sm dark:border-stone-700">
        <p className="font-semibold">{scenario.title}: you are talking to {scenario.character}</p>
        <p className="text-stone-600 dark:text-stone-400">{scenario.setting}. Goal: {scenario.goal}</p>
        {focus && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Focus: {focus}</p>}
      </div>
      <div className="flex min-h-64 flex-col gap-2" aria-live="polite">
        {visible.map((m) => (
          <div key={m.id} className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.role === "user" ? "self-end bg-indigo-600 text-white" : "self-start bg-stone-200 dark:bg-stone-800"}`}>
            <span className="block text-xs opacity-70">{m.role === "user" ? "You" : scenario.character}</span>
            {textOf(m)}
          </div>
        ))}
        {status === "submitted" && <p className="self-start text-xs text-stone-500">{scenario.character} is typing...</p>}
        <div ref={bottom} />
      </div>
      {error && <p className="text-sm text-red-600">Something went wrong: {error.message}</p>}
      {endError && <p className="text-sm text-red-600">{endError}</p>}
      <form onSubmit={send} className="flex gap-2">
        <input value={input} onChange={(e) => setInput(e.target.value)} disabled={busy || full || ending} placeholder={full ? "Session complete" : "Type your reply..."} maxLength={1000}
          className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-900" />
        {speechOk && (
          <button type="button" onClick={toggleMic} aria-label="Dictate" className={`rounded-lg border px-3 text-sm ${listening ? "border-red-500 text-red-600" : "border-stone-300 dark:border-stone-700"}`}>
            {listening ? "Stop" : "Mic"}
          </button>
        )}
        <button disabled={!input.trim() || busy || full || ending} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Send</button>
      </form>
      <div className="flex items-center justify-between text-sm">
        <span className="text-stone-500">{userCount} / {MAX_LINES} lines</span>
        <button onClick={endSession} disabled={userCount === 0 || busy || ending} className="rounded-lg border border-indigo-600 px-3 py-1.5 text-indigo-700 disabled:opacity-40 dark:text-indigo-300">
          {ending ? "Reviewing..." : "End & get feedback"}
        </button>
      </div>
    </div>
  );
}

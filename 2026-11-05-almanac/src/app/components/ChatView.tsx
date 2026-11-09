"use client";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Markdown, SourceDrawer } from "./Markdown";

type ChatItem = { id: string; title: string };

export function ChatView({ id, initial }: { id: string; initial: UIMessage[] }) {
  const [history, setHistory] = useState<ChatItem[]>([]);
  const [cite, setCite] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/chat", prepareSendMessagesRequest: ({ id, messages }) => ({ body: { chatId: id, messages } }) }),
    [],
  );
  const loadHistory = () => fetch("/api/chats").then((r) => r.json()).then(setHistory);
  const { messages, sendMessage, status } = useChat({
    id,
    messages: initial,
    transport,
    onFinish: () => {
      window.history.replaceState(null, "", `/chat/${id}`);
      loadHistory();
    },
  });
  useEffect(() => { loadHistory(); }, []);
  const busy = status === "submitted" || status === "streaming";

  return (
    <div className="flex h-[calc(100vh-4rem)] gap-6">
      <div className="w-56 shrink-0 overflow-auto">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Chat</h1>
          <Link href="/chat" className="btn-ghost" onClick={() => setTimeout(() => window.location.assign("/chat"), 0)}>New</Link>
        </div>
        {history.map((c) => (
          <a key={c.id} href={`/chat/${c.id}`} className={`block truncate rounded px-2 py-1 text-sm hover:bg-slate-100 ${c.id === id ? "bg-indigo-100 text-indigo-800" : ""}`}>{c.title}</a>
        ))}
      </div>
      <div className="flex min-w-0 max-w-3xl flex-1 flex-col">
        <div className="flex-1 space-y-3 overflow-auto pb-4">
          {messages.length === 0 && <p className="text-sm text-slate-500">Ask the brain anything: &quot;what is the company working on?&quot;, &quot;who owns the Harbor Logistics SLA?&quot;</p>}
          {messages.map((m) => (
            <div key={m.id} className={m.role === "user" ? "ml-auto max-w-[80%] rounded-lg bg-indigo-600 px-3 py-2 text-white" : "card"}>
              {m.parts.map((p, i) =>
                p.type === "text" ? (m.role === "user" ? <span key={i}>{p.text}</span> : <Markdown key={i} text={p.text} onCite={setCite} />) : null,
              )}
            </div>
          ))}
          {status === "submitted" && <p className="text-sm text-slate-400">Reading the wiki...</p>}
        </div>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!input.trim() || busy) return; sendMessage({ text: input }); setInput(""); }}>
          <input className="input" placeholder="Ask the company brain..." value={input} onChange={(e) => setInput(e.target.value)} />
          <button className="btn" disabled={busy || !input.trim()}>Send</button>
        </form>
      </div>
      <SourceDrawer id={cite} onClose={() => setCite(null)} />
    </div>
  );
}

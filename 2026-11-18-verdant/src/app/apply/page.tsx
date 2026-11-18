"use client";
import { useState } from "react";
import Link from "next/link";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { CodeSection, PermitType } from "@/lib/types";

type Panel = { candidates: string[]; citations: string[] };

export default function Apply() {
  const [panel, setPanel] = useState<Panel>({ candidates: [], citations: [] });
  const [permits, setPermits] = useState<PermitType[]>([]);
  const [sections, setSections] = useState<CodeSection[]>([]);
  const [input, setInput] = useState("");

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      fetch: async (url, init) => {
        const res = await fetch(url, init);
        try {
          const candidates = JSON.parse(res.headers.get("x-permit-candidates") ?? "[]") as string[];
          const citations = JSON.parse(res.headers.get("x-citations") ?? "[]") as string[];
          setPanel({ candidates, citations });
          const [pt, cs] = await Promise.all([
            permits.length ? permits : fetch("/api/permit-types").then((r) => r.json()),
            sections.length ? sections : fetch("/api/code-sections").then((r) => r.json()),
          ]);
          setPermits(pt);
          setSections(cs);
        } catch {
          /* header parsing is best-effort */
        }
        return res;
      },
    }),
  });

  const busy = status === "submitted" || status === "streaming";
  const recommended = permits.filter((p) => panel.candidates.includes(p.id));
  const cited = sections.filter((s) => panel.citations.includes(s.id));

  return (
    <div className="split">
      <div className="card chat">
        <h2>Which permit do I need?</h2>
        {messages.length === 0 && (
          <p className="muted">Describe your project, e.g. &quot;I want to build a 6 foot fence in my backyard&quot;.</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            {m.parts.map((p, i) => (p.type === "text" ? <span key={i}>{p.text}</span> : null))}
          </div>
        ))}
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!input.trim() || busy) return;
            sendMessage({ text: input });
            setInput("");
          }}
        >
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Describe your project" />
          <button disabled={busy}>Send</button>
        </form>
      </div>
      <div className="card">
        <h2>Recommended permits</h2>
        {recommended.length === 0 && <p className="muted">Recommendations appear here.</p>}
        {recommended.map((p) => (
          <div key={p.id} className="check pass">
            <strong>{p.name}</strong>
            <div className="muted">{p.description}</div>
            <Link href={`/apply/${p.id}`}><button type="button">Start application</button></Link>
          </div>
        ))}
        <h3>Cited code sections</h3>
        {cited.map((s) => (
          <p key={s.id} className="muted"><strong>§ {s.id}</strong> {s.title}</p>
        ))}
      </div>
    </div>
  );
}

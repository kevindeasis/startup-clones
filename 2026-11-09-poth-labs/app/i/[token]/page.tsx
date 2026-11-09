"use client";
import { use, useEffect, useRef, useState } from "react";

interface Msg { role: "assistant" | "user"; content: string }

export default function Respondent({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [done, setDone] = useState(false);
  const [finished, setFinished] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [meta, setMeta] = useState({ turn: 0, maxTurns: 5 });
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/interview/${token}`).then(async (r) => {
      const j = await r.json();
      if (!r.ok) return setErr(j.error);
      setMsgs(j.messages); setMeta({ turn: j.turn, maxTurns: j.maxTurns });
      if (j.status === "done") { setDone(true); setFinished(true); }
    });
  }, [token]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  async function finish() {
    setBusy(true);
    const r = await fetch(`/api/interview/${token}/finish`, { method: "POST" });
    setBusy(false);
    if (r.ok) setFinished(true); else setErr((await r.json()).error);
  }

  async function send() {
    const content = text.trim();
    if (!content) return;
    setText(""); setBusy(true); setErr("");
    setMsgs((m) => [...m, { role: "user", content }]);
    const r = await fetch(`/api/interview/${token}/message`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content }) });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) return setErr(j.error);
    setMsgs((m) => [...m, { role: "assistant", content: j.reply }]);
    setMeta({ turn: j.turn, maxTurns: j.maxTurns });
    if (j.done) { setDone(true); await finish(); }
  }

  return (
    <>
      <h1>Customer interview</h1>
      <p className="mut">Answer in your own words. There are no right or wrong answers. ({meta.turn}/{meta.maxTurns} answers)</p>
      <div className="chat">
        {msgs.map((m, i) => <div key={i} className={`msg ${m.role}`}>{m.content}</div>)}
        <div ref={end} />
      </div>
      {err && <p className="err">{err}</p>}
      {finished ? <div className="card">Interview complete. Thank you!</div> : (
        <div className="row">
          <textarea style={{ flex: 1, minHeight: 60, fontFamily: "inherit" }} value={text} disabled={busy || done} placeholder="Type your answer"
            onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
          <button disabled={busy || done || !text.trim()} onClick={send}>Send</button>
          {meta.turn > 0 && !done && <button className="sec" disabled={busy} onClick={async () => { await finish(); setDone(true); }}>Finish now</button>}
        </div>
      )}
    </>
  );
}

"use client";
import { useState } from "react";

interface N { id: string; text: string; createdAt: string }

export function DraftPanel({ pursuitId, initial }: { pursuitId: string; initial: N[] }) {
  const [notes, setNotes] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState("");
  async function draft() {
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/pursuits/${pursuitId}/draft`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) setErr(data.error ?? "Failed");
    else setNotes([data, ...notes]);
    setBusy(false);
  }
  return (
    <>
      <button onClick={draft} disabled={busy}>{busy ? "Drafting..." : "Draft cover letter"}</button>
      {err && <span className="err"> {err}</span>}
      {notes.map((n) => (
        <div className="card" key={n.id} style={{ marginTop: 10 }}>
          <pre className="letter">{n.text}</pre>
          <button className="secondary" onClick={async () => { await navigator.clipboard.writeText(n.text); setCopied(n.id); }}>{copied === n.id ? "Copied" : "Copy"}</button>
          <span className="muted"> {n.createdAt.slice(0, 16).replace("T", " ")}</span>
        </div>
      ))}
    </>
  );
}

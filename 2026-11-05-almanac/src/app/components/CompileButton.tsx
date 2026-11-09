"use client";
import { useState } from "react";

export function CompileButton({ onDone, label = "Compile wiki" }: { onDone?: () => void; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  return (
    <span className="inline-flex items-center gap-3">
      <button
        className="btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMsg("");
          const r = await fetch("/api/compile", { method: "POST" });
          const j = await r.json();
          setBusy(false);
          setMsg(r.ok ? `Processed ${j.sourceIds.length} sources, changed ${j.pagesChanged.length} pages.` : `Error: ${j.error}`);
          onDone?.();
        }}
      >
        {busy ? "Compiling..." : label}
      </button>
      {msg && <span className="text-sm text-slate-600">{msg}</span>}
    </span>
  );
}

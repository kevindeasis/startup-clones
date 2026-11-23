"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function TrackButton({ signalId, documentId, pursuitId, label }: { signalId?: string; documentId?: string; pursuitId?: string; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (pursuitId) return <a className="btn secondary" href={`/pursuits/${pursuitId}`}>Open pursuit</a>;
  async function go() {
    setBusy(true);
    setErr("");
    const res = await fetch("/api/pursuits", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signalId, documentId }) });
    const data = await res.json();
    if (!res.ok) {
      setErr(data.error ?? "failed");
      setBusy(false);
      return;
    }
    router.push(`/pursuits/${data.pursuit.id}`);
  }
  return (
    <span>
      <button onClick={go} disabled={busy}>{busy ? "Creating..." : (label ?? "Track")}</button>
      {err && <span className="err"> {err}</span>}
    </span>
  );
}

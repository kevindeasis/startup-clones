"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SynthesiseButton({ studyId, disabled }: { studyId: string; disabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/studies/${studyId}/synthesise`, { method: "POST" });
    if (!res.ok) setError((await res.json()).error ?? "Synthesis failed");
    setBusy(false);
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button onClick={run} disabled={busy || disabled} className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white disabled:opacity-50">
        {busy ? "Synthesising…" : "Synthesise"}
      </button>
      {error && <span className="text-sm text-red-600">{error}</span>}
    </span>
  );
}

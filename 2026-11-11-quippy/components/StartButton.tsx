"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function StartButton({ scenarioId, label = "Start" }: { scenarioId: string; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function start() {
    setBusy(true);
    setError("");
    const res = await fetch("/api/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenarioId }) });
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Could not start");
      setBusy(false);
      return;
    }
    const { id } = await res.json();
    router.push(`/practice/${scenarioId}?s=${id}`);
  }
  return (
    <div>
      <button onClick={start} disabled={busy} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
        {busy ? "Starting..." : label}
      </button>
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}

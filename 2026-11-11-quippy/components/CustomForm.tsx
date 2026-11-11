"use client";
import { useState } from "react";
import { StartButton } from "./StartButton";

export function CustomForm() {
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ id: string; title: string; character: string; persona: string; goal: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/scenarios/custom", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ description }) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not create scenario");
    setCreated(data);
  }

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="space-y-3">
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} maxLength={500} placeholder="e.g. I need to tell my landlord the heating has been broken for a week and ask for a fix date."
          className="w-full rounded-lg border border-stone-300 bg-white p-3 text-sm dark:border-stone-700 dark:bg-stone-900" />
        <button disabled={busy || description.trim().length < 5} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          {busy ? "Creating..." : "Create scenario"}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
      {created && (
        <div className="rounded-xl border border-emerald-300 p-4 dark:border-emerald-800">
          <h3 className="font-semibold">{created.title}</h3>
          <p className="text-sm"><strong>{created.character}</strong>, {created.persona}</p>
          <p className="text-sm text-stone-600 dark:text-stone-400">Goal: {created.goal}</p>
          <div className="mt-3"><StartButton scenarioId={created.id} label="Start this scenario" /></div>
        </div>
      )}
    </div>
  );
}

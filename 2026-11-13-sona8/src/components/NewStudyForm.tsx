"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const field = "mt-1 w-full rounded border bg-white px-3 py-2 text-sm";

export default function NewStudyForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const teams = String(f.get("teams") ?? "").split(",").map((t) => t.trim()).filter(Boolean);
    setBusy(true);
    const res = await fetch("/api/studies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: f.get("title"), topic: f.get("topic"), goal: f.get("goal"), teams }),
    });
    if (!res.ok) {
      setError("Title and topic are required.");
      setBusy(false);
      return;
    }
    const study = await res.json();
    router.push(`/studies/${study.id}`);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block text-sm font-medium">Title
        <input name="title" required className={field} placeholder="Sales quote creation — EMEA" />
      </label>
      <label className="block text-sm font-medium">Topic / question under investigation
        <input name="topic" required className={field} placeholder="How does a sales quote get created?" />
      </label>
      <label className="block text-sm font-medium">Goal
        <textarea name="goal" rows={3} className={field} placeholder="What do you want to learn or change?" />
      </label>
      <label className="block text-sm font-medium">Teams / sites (comma separated, optional)
        <input name="teams" className={field} placeholder="Sales, Finance" />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button disabled={busy} className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50">Create study</button>
    </form>
  );
}

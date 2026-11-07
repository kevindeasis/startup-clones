"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const input = "w-full rounded-md border border-stone-300 bg-transparent px-3 py-2 text-sm dark:border-stone-700";

export default function NewStudyForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError("");
    const res = await fetch("/api/studies", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: f.get("title"), goal: f.get("goal"), audience: f.get("audience"), seed_questions: String(f.get("seeds") || "") }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) return setError(data.error || "Failed");
    router.push(`/studies/${data.id}`);
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <input name="title" required placeholder="Title" className={input} />
      <textarea name="goal" required rows={3} placeholder="What do you want to learn about your buyers?" className={input} />
      <input name="audience" required placeholder="Target audience (e.g. heads of marketing at B2B SaaS)" className={input} />
      <textarea name="seeds" rows={3} placeholder="Optional seed questions, one per line" className={input} />
      <button disabled={busy} className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900">
        {busy ? "Drafting guide..." : "Create study & draft guide"}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}

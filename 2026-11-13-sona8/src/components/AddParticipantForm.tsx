"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const field = "rounded border bg-white px-2 py-1.5 text-sm";

export default function AddParticipantForm({ studyId, teams }: { studyId: string; teams: string[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setBusy(true);
    await fetch(`/api/studies/${studyId}/participants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(f)),
    });
    form.reset();
    setBusy(false);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap gap-2">
      <input name="name" placeholder="Name (optional)" className={field} />
      <input name="team" list="teams" placeholder="Team" className={field} />
      <datalist id="teams">{teams.map((t) => <option key={t} value={t} />)}</datalist>
      <input name="site" placeholder="Site" className={field} />
      <input name="role" placeholder="Role" className={field} />
      <button disabled={busy} className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">Add participant</button>
    </form>
  );
}

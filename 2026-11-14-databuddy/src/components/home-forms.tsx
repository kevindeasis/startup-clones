"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, inputClass } from "./ui";

export function CreateSiteForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    const res = await fetch("/api/sites", {
      method: "POST",
      body: JSON.stringify({ name: form.get("name"), domain: form.get("domain") }),
    });
    const body = await res.json();
    if (!res.ok) {
      setError(body.error);
      setBusy(false);
      return;
    }
    router.push(`/sites/${body.id}/setup`);
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Name
        <input name="name" required placeholder="My startup" className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Domain
        <input name="domain" required placeholder="example.com" className={inputClass} />
      </label>
      <Button type="submit" disabled={busy}>Create site</Button>
      {error && <p className="w-full text-sm text-red-600">{error}</p>}
    </form>
  );
}

export function SeedButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function seed() {
    setBusy(true);
    await fetch("/api/seed", { method: "POST" });
    router.refresh();
    setBusy(false);
  }

  return <Button onClick={seed} disabled={busy}>{busy ? "Seeding..." : "Seed demo data"}</Button>;
}

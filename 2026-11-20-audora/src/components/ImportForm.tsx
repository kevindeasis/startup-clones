"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Sample = { id: string; title: string; words: number };

export function ImportForm({ samples }: { samples: Sample[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create(init: RequestInit) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/stories", init);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Import failed");
      router.push(`/stories/${data.story.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
      setBusy(false);
    }
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const file = fd.get("file");
    const title = String(fd.get("title") ?? "");
    if (file instanceof File && file.size > 0) {
      void create({ method: "POST", body: fd });
      return;
    }
    const url = String(fd.get("url") ?? "").trim();
    const text = String(fd.get("text") ?? "");
    void create({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, ...(url ? { url } : { text }) }),
    });
  }

  return (
    <>
      <form onSubmit={onSubmit} className="form">
        <label>
          Title (optional)
          <input name="title" type="text" placeholder="Defaults to the page title or first line" />
        </label>
        <label>
          Paste text
          <textarea name="text" rows={6} placeholder="Paste your story here..." />
        </label>
        <div className="row">
          <label className="grow">
            ...or upload a .txt / .md file
            <input name="file" type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" />
          </label>
          <label className="grow">
            ...or a public URL
            <input name="url" type="url" placeholder="https://example.com/story" />
          </label>
        </div>
        <div className="row">
          <button type="submit" className="btn primary" disabled={busy}>{busy ? "Importing..." : "Import story"}</button>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </form>
      <h3>Or try a bundled public-domain sample</h3>
      <div className="row wrap">
        {samples.map((s) => (
          <button
            key={s.id}
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => create({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sampleId: s.id }) })}
          >
            Load sample: {s.title} ({s.words} words)
          </button>
        ))}
      </div>
    </>
  );
}

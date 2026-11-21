"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function NewsIngestForm() {
  const router = useRouter();
  const [tab, setTab] = useState<"paste" | "url">("paste");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body =
      tab === "url"
        ? { url: String(fd.get("url") ?? "") }
        : { title: String(fd.get("title") ?? ""), text: String(fd.get("text") ?? ""), source: String(fd.get("source") ?? "") || undefined };
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const r = await fetch("/api/news/ingest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Ingest failed");
      const it = j.item;
      setMsg(
        it.creditRelevant
          ? `Credit-relevant: ${it.eventType} / ${it.severity}, tagged ${it.obligorIds.length} obligor(s).`
          : "Not credit-relevant: stored but hidden (use 'show filtered').",
      );
      router.refresh();
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="panel">
      <summary>Add an article</summary>
      <form onSubmit={submit} className="stack" aria-label="Ingest news">
        <div className="row">
          <button type="button" className={tab === "paste" ? "" : "ghost"} onClick={() => setTab("paste")}>
            Paste text
          </button>
          <button type="button" className={tab === "url" ? "" : "ghost"} onClick={() => setTab("url")}>
            From URL
          </button>
        </div>
        {tab === "url" ? (
          <label>
            Article URL
            <input type="url" name="url" required placeholder="https://..." />
          </label>
        ) : (
          <>
            <label>
              Title
              <input type="text" name="title" required />
            </label>
            <label>
              Source
              <input type="text" name="source" placeholder="Local Gazette" />
            </label>
            <label>
              Text
              <textarea name="text" rows={4} required />
            </label>
          </>
        )}
        <div className="row">
          <button type="submit" disabled={busy}>
            {busy ? "Classifying..." : "Ingest"}
          </button>
        </div>
        {msg && <div className="ok">{msg}</div>}
        {err && <div className="error">{err}</div>}
      </form>
    </details>
  );
}

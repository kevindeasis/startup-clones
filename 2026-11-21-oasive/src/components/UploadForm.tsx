"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function UploadForm({ obligorId }: { obligorId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const r = await fetch(`/api/obligors/${obligorId}/documents`, { method: "POST", body: new FormData(form) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Upload failed");
      setMsg(
        `Indexed ${j.document.pageCount} page(s), ${j.document.chunkCount} chunk(s); extracted ${j.extraction.metrics} metrics and ${j.extraction.events} events (${j.extraction.unverified} unverified).`,
      );
      form.reset();
      router.refresh();
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="stack" aria-label="Upload document">
      <label>
        File (.pdf, .txt, .md)
        <input type="file" name="file" accept=".pdf,.txt,.md" required />
      </label>
      <div className="grid2">
        <label>
          Document type
          <select name="type" defaultValue="audit">
            <option value="audit">Audit / ACFR</option>
            <option value="official_statement">Official statement</option>
            <option value="budget">Budget</option>
            <option value="board_minutes">Board agenda / minutes</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label>
          Fiscal year
          <input type="number" name="fiscalYear" min={1990} max={2100} placeholder="2025" />
        </label>
      </div>
      <label>
        Title (optional)
        <input type="text" name="title" />
      </label>
      <div className="row">
        <button type="submit" disabled={busy}>
          {busy ? "Ingesting..." : "Upload and extract"}
        </button>
      </div>
      {msg && <div className="ok">{msg}</div>}
      {err && <div className="error">{err}</div>}
    </form>
  );
}

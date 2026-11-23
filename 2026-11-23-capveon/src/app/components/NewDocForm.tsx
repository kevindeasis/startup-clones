"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface Opt { id: string; name: string }

export function NewDocForm({ agencies, solicitations }: { agencies: Opt[]; solicitations: Opt[] }) {
  const router = useRouter();
  const [kind, setKind] = useState("minutes");
  const [agencyId, setAgencyId] = useState(agencies[0]?.id ?? "__new");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const fd = new FormData(e.currentTarget);
    if (agencyId !== "__new") {
      fd.set("agencyId", agencyId);
      fd.delete("agencyName");
    }
    if (kind !== "addendum") fd.delete("parentDocumentId");
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) fd.delete("file");
    if (!fd.get("text")) fd.delete("text");
    const res = await fetch("/api/documents", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) {
      setErr(data.error ?? "Failed");
      setBusy(false);
      return;
    }
    router.push(`/documents/${data.id}`);
  }

  return (
    <form onSubmit={submit} className="card form-grid">
      <label className="full">Title<input name="title" required /></label>
      <label>Agency
        <select value={agencyId} onChange={(e) => setAgencyId(e.target.value)}>
          {agencies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          <option value="__new">+ New agency...</option>
        </select>
      </label>
      {agencyId === "__new" ? <label>New agency name<input name="agencyName" required /></label> : <span />}
      <label>Kind
        <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          {["minutes", "cip", "budget", "solicitation", "addendum", "other"].map((k) => <option key={k}>{k}</option>)}
        </select>
      </label>
      <label>Date<input name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label>
      {kind === "addendum" && (
        <label className="full">Parent solicitation
          <select name="parentDocumentId" required>
            {solicitations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      )}
      <label className="full">Paste text (use <code>--- page N ---</code> lines or form feeds to split pages)<textarea name="text" placeholder="Paste document text here, or upload a file below" /></label>
      <label className="full">...or upload .txt / .md / .pdf<input name="file" type="file" accept=".txt,.md,.markdown,.pdf,text/plain,application/pdf" /></label>
      <div className="full">
        <button disabled={busy}>{busy ? "Extracting..." : "Ingest & extract"}</button>
        {err && <span className="err"> {err}</span>}
      </div>
    </form>
  );
}

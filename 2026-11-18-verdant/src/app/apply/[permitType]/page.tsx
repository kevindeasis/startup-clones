"use client";
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Checks } from "@/components/Checks";
import type { Attachment, Check, PermitType } from "@/lib/types";

const KINDS: Attachment["kind"][] = ["site_plan", "floor_plan", "elevations", "other"];

export default function Intake({ params }: { params: Promise<{ permitType: string }> }) {
  const { permitType } = use(params);
  const router = useRouter();
  const [permit, setPermit] = useState<PermitType | null>(null);
  const [applicant, setApplicant] = useState({ name: "", email: "", phone: "" });
  const [address, setAddress] = useState("");
  const [zoning, setZoning] = useState("R-1");
  const [description, setDescription] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [kind, setKind] = useState<Attachment["kind"]>("site_plan");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [advice, setAdvice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/permit-types").then((r) => r.json()).then((all: PermitType[]) => setPermit(all.find((p) => p.id === permitType) ?? null));
  }, [permitType]);

  async function addFile(file: File) {
    // Text extraction happens server-side with unpdf (PDF) or as plain text (.txt).
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", kind);
    const tmp = await fetch("/api/extract", { method: "POST", body: fd }).then((r) => r.json());
    if (tmp.error) throw new Error(tmp.error);
    setAttachments((a) => [...a, { id: `new-${a.length}`, filename: file.name, kind, text: tmp.text, pages: tmp.pages }]);
  }

  function numericFields() {
    const out: Record<string, string | number> = {};
    for (const f of permit?.requiredFields ?? []) {
      const v = fields[f.name];
      if (v === undefined || v === "") continue;
      out[f.name] = f.type === "number" ? Number(v) : v;
    }
    return out;
  }

  async function pickFiles(list: FileList | null) {
    setError("");
    try {
      for (const f of Array.from(list ?? [])) {
        if (!/\.(pdf|txt)$/i.test(f.name)) throw new Error("Only .pdf and .txt files are accepted");
        await addFile(f);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function precheck() {
    setBusy(true);
    const res = await fetch("/api/precheck", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ permitType, fields: numericFields(), attachments }),
    }).then((r) => r.json());
    setChecks(res.checks);
    setAdvice(res.advice);
    setBusy(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!applicant.name || !applicant.email || !address || !description) return setError("Name, email, address and description are required.");
    setBusy(true);
    const res = await fetch("/api/applications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ permitType, applicant, address, zoning, projectDescription: description, fields: numericFields(), attachments }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Submit failed");
    router.push(`/staff/${data.id}`);
  }

  if (!permit) return <p>Loading…</p>;
  return (
    <form className="card" onSubmit={submit}>
      <h1>{permit.name}</h1>
      <p className="muted">{permit.description} Required documents: {permit.requiredDocuments.join(", ") || "none"}.</p>
      <label>Name<input value={applicant.name} onChange={(e) => setApplicant({ ...applicant, name: e.target.value })} /></label>
      <label>Email<input type="email" value={applicant.email} onChange={(e) => setApplicant({ ...applicant, email: e.target.value })} /></label>
      <label>Phone (optional)<input value={applicant.phone} onChange={(e) => setApplicant({ ...applicant, phone: e.target.value })} /></label>
      <label>Property address<input value={address} onChange={(e) => setAddress(e.target.value)} /></label>
      <label>Zoning<select value={zoning} onChange={(e) => setZoning(e.target.value)}><option>R-1</option><option>R-2</option><option>C-1</option></select></label>
      {permit.requiredFields.map((f) => (
        <label key={f.name}>{f.label}
          <input type={f.type === "number" ? "number" : "text"} value={fields[f.name] ?? ""} onChange={(e) => setFields({ ...fields, [f.name]: e.target.value })} />
        </label>
      ))}
      <label>Project description<textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      <label>Attachment type<select value={kind} onChange={(e) => setKind(e.target.value as Attachment["kind"])}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
      <label>Attach file (.pdf or .txt)<input type="file" accept=".pdf,.txt" multiple onChange={(e) => pickFiles(e.target.files)} /></label>
      <ul>{attachments.map((a, i) => <li key={i}>{a.filename} ({a.kind}{a.pages ? `, ${a.pages} pages` : ""})</li>)}</ul>
      <div className="actions">
        <button type="button" className="secondary" onClick={precheck} disabled={busy}>Run pre-check</button>
        <button disabled={busy}>Submit</button>
      </div>
      {error && <p className="error">{error}</p>}
      {checks && (
        <div className="card">
          <h2>Pre-check</h2>
          <p>{advice}</p>
          <Checks checks={checks} />
        </div>
      )}
    </form>
  );
}

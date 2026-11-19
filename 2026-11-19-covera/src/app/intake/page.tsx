"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FIELD_LABEL } from "@/components/format";
import { getPath, setPath } from "@/lib/path";
import { computeMissing } from "@/lib/requirements";
import { LINES, LINE_LABELS } from "@/lib/types";
import type { Line, MissingItem, RiskProfile } from "@/lib/types";

const SAMPLES = [
  { id: "01-restaurant", label: "Restaurant (BOP + liquor)" },
  { id: "02-landscaper", label: "Landscaper (GL + auto + WC)" },
  { id: "03-ecommerce", label: "E-commerce (BOP + cyber, no revenue)" },
  { id: "04-contractor-renewal", label: "Contractor renewal (prior claim)" },
];

const INDUSTRIES = [
  "restaurant", "retail", "contractor", "professional-services", "e-commerce", "landscaping",
  "auto-repair", "bakery", "salon", "software", "trucking", "wholesale",
];

type FieldDef = { path: string; label: string; kind: "text" | "number" | "bool" | "textarea" | "industry" };

const FIELDS: FieldDef[] = [
  { path: "businessName", label: "Business name", kind: "text" },
  { path: "contactName", label: "Contact name", kind: "text" },
  { path: "contactEmail", label: "Contact email", kind: "text" },
  { path: "industry", label: "Industry", kind: "industry" },
  { path: "address.street", label: "Street", kind: "text" },
  { path: "address.city", label: "City", kind: "text" },
  { path: "address.state", label: "State", kind: "text" },
  { path: "address.zip", label: "ZIP", kind: "text" },
  { path: "yearsInBusiness", label: "Years in business", kind: "number" },
  { path: "annualRevenue", label: "Annual revenue ($)", kind: "number" },
  { path: "annualPayroll", label: "Annual payroll ($)", kind: "number" },
  { path: "employees", label: "Employees", kind: "number" },
  { path: "building.squareFeet", label: "Building sq ft", kind: "number" },
  { path: "building.yearBuilt", label: "Year built", kind: "number" },
  { path: "building.sprinklered", label: "Sprinklered", kind: "bool" },
  { path: "building.owned", label: "Building owned", kind: "bool" },
  { path: "vehicles", label: "Vehicles", kind: "number" },
  { path: "priorClaims.count", label: "Prior claims", kind: "number" },
  { path: "effectiveDate", label: "Effective date", kind: "text" },
  { path: "description", label: "Description", kind: "text" },
  { path: "notes", label: "Notes", kind: "textarea" },
];

export default function IntakePage() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<{ filename: string; base64: string }[]>([]);
  const [profile, setProfile] = useState<RiskProfile | null>(null);
  const [followUp, setFollowUp] = useState("");
  const [attachmentTexts, setAttachmentTexts] = useState<{ filename: string; text: string }[]>([]);
  const [busy, setBusy] = useState<"extract" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const missing: MissingItem[] = profile ? computeMissing(profile) : [];

  async function loadSample(id: string) {
    const r = await fetch(`/api/samples/${id}`);
    const d = await r.json();
    setText(d.text);
    setProfile(null);
  }

  async function onFiles(list: FileList | null) {
    if (!list) return;
    const out: { filename: string; base64: string }[] = [];
    for (const f of Array.from(list)) {
      const buf = new Uint8Array(await f.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
      out.push({ filename: f.name, base64: btoa(bin) });
    }
    setFiles(out);
  }

  async function extract() {
    setBusy("extract");
    setError(null);
    try {
      const r = await fetch("/api/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, attachments: files }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Extraction failed");
      setProfile(d.profile);
      setFollowUp(d.followUpEmail);
      setAttachmentTexts(d.attachments ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!profile) return;
    setBusy("save");
    setError(null);
    try {
      const r = await fetch("/api/opportunities", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, attachments: attachmentTexts, profile }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Save failed");
      router.push(`/opportunities/${d.opportunity.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  function setField(def: FieldDef, raw: string) {
    if (!profile) return;
    let v: unknown = raw === "" ? undefined : raw;
    if (def.kind === "number" && raw !== "") v = Number(raw);
    if (def.kind === "bool") v = raw === "" ? undefined : raw === "true";
    setProfile(setPath(profile, def.path, v));
  }

  function toggleLine(l: Line) {
    if (!profile) return;
    const has = profile.requestedLines.includes(l);
    const next = LINES.filter((x) => (x === l ? !has : profile.requestedLines.includes(x)));
    setProfile({ ...profile, requestedLines: next });
  }

  return (
    <>
      <h1>New intake</h1>
      <p className="muted">Paste a client email or upload a .txt / .pdf attachment. BrokerDesk extracts a risk profile and drafts a follow-up for missing items.</p>
      <div className="row wrap">
        {SAMPLES.map((s) => (
          <button key={s.id} className="btn" onClick={() => loadSample(s.id)}>Load sample: {s.label}</button>
        ))}
      </div>
      <label className="field">
        <span>Client email</span>
        <textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the client email here..." />
      </label>
      <label className="field">
        <span>Attachments (.txt, .pdf)</span>
        <input type="file" accept=".txt,.pdf" multiple onChange={(e) => onFiles(e.target.files)} />
      </label>
      <button className="btn primary" onClick={extract} disabled={busy !== null || (!text.trim() && files.length === 0)}>
        {busy === "extract" ? "Extracting..." : "Extract"}
      </button>
      {error && <p className="error">{error}</p>}

      {profile && (
        <>
          <h2>Risk profile</h2>
          <div className="fieldset">
            {FIELDS.map((def) => {
              const val = getPath(profile, def.path);
              return (
                <label key={def.path} className="field">
                  <span>{def.label}</span>
                  {def.kind === "bool" ? (
                    <select value={val === undefined ? "" : String(val)} onChange={(e) => setField(def, e.target.value)}>
                      <option value="">unknown</option>
                      <option value="true">yes</option>
                      <option value="false">no</option>
                    </select>
                  ) : def.kind === "industry" ? (
                    <select value={(val as string) ?? ""} onChange={(e) => setField(def, e.target.value)}>
                      <option value="">unknown</option>
                      {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
                    </select>
                  ) : def.kind === "textarea" ? (
                    <textarea rows={2} value={(val as string) ?? ""} onChange={(e) => setField(def, e.target.value)} />
                  ) : (
                    <input type={def.kind === "number" ? "number" : "text"} value={val === undefined ? "" : String(val)} onChange={(e) => setField(def, e.target.value)} />
                  )}
                </label>
              );
            })}
          </div>
          <div className="row wrap">
            <strong>Requested lines:</strong>
            {LINES.map((l) => (
              <label key={l} className="check">
                <input type="checkbox" checked={profile.requestedLines.includes(l)} onChange={() => toggleLine(l)} /> {LINE_LABELS[l]}
              </label>
            ))}
          </div>
          <h2>Missing items ({missing.length})</h2>
          {missing.length === 0 ? <p className="muted">Nothing missing. Ready to quote.</p> : (
            <ul>
              {missing.map((m, i) => (
                <li key={i}><span className="tag warn">{m.line}</span> {FIELD_LABEL[m.field] ?? m.field} <span className="muted small">- {m.why}</span></li>
              ))}
            </ul>
          )}
          <h2>Follow-up email draft</h2>
          <pre className="email">{followUp}</pre>
          <p className="small muted">The follow-up is regenerated from your edits when the opportunity is saved.</p>
          <button className="btn primary" onClick={save} disabled={busy !== null}>{busy === "save" ? "Saving..." : "Save opportunity"}</button>
        </>
      )}
    </>
  );
}

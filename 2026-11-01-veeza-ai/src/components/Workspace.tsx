"use client";
import { useCallback, useEffect, useState } from "react";
import type { Destination, DocRequirement } from "@/lib/destinations";
import { PASSPORT_KEYS, STATUSES, type PassportConfidence, type PassportFields, type RuleResult, type Verification } from "@/lib/types";

interface View {
  application: {
    id: string; destinationCode: string; nationality: string; purpose: string; departureDate: string;
    returnDate: string; travellerCount: number; status: string; notes: { at: string; text: string }[];
  };
  destination: Destination;
  requiredDocuments: DocRequirement[];
  serviceFeeUSD: number;
  travellers: { id: string; index: number; passport: PassportFields; passportConfidence: PassportConfidence }[];
  documents: { id: string; travellerId: string | null; type: string; verification: Verification }[];
  checks: RuleResult[];
  score: { score: number; band: string };
}
interface Readiness { score: number; band: string; narrative: string; topFixes: string[]; ruleResults: RuleResult[]; disclaimer: string }

const TABS = ["Travellers", "Documents", "Readiness", "Forms", "Review"] as const;
type Tab = (typeof TABS)[number];

const sevColor: Record<string, string> = {
  ok: "bg-green-100 text-green-800", warning: "bg-amber-100 text-amber-800",
  fail: "bg-red-100 text-red-800", missing: "bg-slate-200 text-slate-700",
};
const Badge = ({ s }: { s: string }) => <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${sevColor[s] ?? ""}`}>{s}</span>;

export default function Workspace({ id }: { id: string }) {
  const [view, setView] = useState<View | null>(null);
  const [tab, setTab] = useState<Tab>("Travellers");
  const [err, setErr] = useState("");

  const reload = useCallback(async () => {
    const res = await fetch(`/api/applications/${id}`);
    if (!res.ok) { setErr("Application not found."); return; }
    setView(await res.json());
  }, [id]);
  useEffect(() => { reload(); }, [reload]);

  if (err) return <p className="text-red-600">{err}</p>;
  if (!view) return <p className="text-slate-500">Loading...</p>;
  const a = view.application;

  return (
    <div className="space-y-6">
      <div className="card flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{view.destination.name} - {view.destination.visaType}</h1>
          <p className="text-sm text-slate-600">
            {a.departureDate} to {a.returnDate} | {a.travellerCount} traveller(s) | {a.nationality} passport(s) | status: <b>{a.status}</b>
          </p>
          <p className="text-xs text-slate-500">Illustrative service fee: ${view.serviceFeeUSD}. {view.destination.note}</p>
        </div>
        <div className="text-right">
          <div className="text-3xl font-bold text-indigo-700">{view.score.score}</div>
          <div className="text-xs text-slate-500">{view.score.band}</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={tab === t ? "btn" : "btn-secondary"}>{t}</button>
        ))}
      </div>
      {tab === "Travellers" && <Travellers view={view} reload={reload} />}
      {tab === "Documents" && <Documents view={view} reload={reload} />}
      {tab === "Readiness" && <ReadinessTab id={id} version={JSON.stringify(view.checks)} />}
      {tab === "Forms" && <Forms view={view} />}
      {tab === "Review" && <Review view={view} reload={reload} />}
    </div>
  );
}

function Travellers({ view, reload }: { view: View; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string[]>([]);
  const a = view.application;

  async function upload(file: File) {
    setBusy(true); setMsg([]);
    const fd = new FormData(); fd.append("file", file);
    const res = await fetch(`/api/applications/${a.id}/travellers`, { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) setMsg([data.error]);
    else setMsg([...(data.warnings ?? []), ...data.validity.map((v: RuleResult) => v.message)]);
    await reload(); setBusy(false);
  }

  return (
    <div className="space-y-4">
      {view.travellers.map((t) => <PassportEditor key={t.id} t={t} reload={reload} />)}
      {view.travellers.length < a.travellerCount && (
        <div className="card">
          <h2 className="font-semibold">Upload passport for traveller {view.travellers.length + 1} of {a.travellerCount}</h2>
          <p className="mb-2 text-sm text-slate-600">JPEG, PNG or PDF, max 5 MB. Fields are extracted by AI and you can edit them.</p>
          <input type="file" accept="image/jpeg,image/png,application/pdf" disabled={busy}
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          {busy && <p className="mt-2 text-sm text-slate-500">Extracting...</p>}
        </div>
      )}
      {msg.length > 0 && <ul className="card list-disc space-y-1 pl-8 text-sm text-amber-800">{msg.map((m, i) => <li key={i}>{m}</li>)}</ul>}
    </div>
  );
}

function PassportEditor({ t, reload }: { t: View["travellers"][number]; reload: () => Promise<void> }) {
  const [p, setP] = useState<PassportFields>(t.passport);
  const [saved, setSaved] = useState("");
  const [validity, setValidity] = useState<RuleResult[]>([]);
  async function save() {
    const res = await fetch(`/api/travellers/${t.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ passport: p }),
    });
    const data = await res.json();
    setSaved(res.ok ? "Saved" : data.error); setValidity(data.validity ?? []);
    await reload();
  }
  return (
    <div className="card space-y-3">
      <h2 className="font-semibold">Traveller {t.index}: {t.passport.givenNames} {t.passport.surname}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {PASSPORT_KEYS.map((k) => {
          const c = t.passportConfidence[k];
          return (
            <div key={k}>
              <label className="label">{k} {typeof c === "number" && <span className={c < 0.8 ? "text-amber-600" : "text-green-600"}>({Math.round(c * 100)}%)</span>}</label>
              <input className="input" value={p[k] ?? ""} onChange={(e) => setP({ ...p, [k]: e.target.value || null })} />
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-3">
        <button className="btn" onClick={save}>Save changes</button>
        <span className="text-sm text-slate-600">{saved}</span>
      </div>
      {validity.map((v, i) => <p key={i} className="text-sm text-red-700">{v.message}</p>)}
    </div>
  );
}

function Documents({ view, reload }: { view: View; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const a = view.application;

  async function upload(req: DocRequirement, travellerId: string | null, file: File) {
    const key = `${req.type}:${travellerId}`;
    setBusy(key); setErr("");
    const fd = new FormData();
    fd.append("type", req.type); fd.append("file", file);
    if (travellerId) fd.append("travellerId", travellerId);
    const res = await fetch(`/api/applications/${a.id}/documents`, { method: "POST", body: fd });
    if (!res.ok) setErr((await res.json()).error);
    await reload(); setBusy("");
  }

  return (
    <div className="space-y-4">
      {err && <p className="text-sm text-red-600">{err}</p>}
      {view.requiredDocuments.map((req) => {
        const slots = req.type === "passport_copy"
          ? []
          : req.scope === "shared" ? [{ id: null as string | null, label: "" }]
          : view.travellers.map((t) => ({ id: t.id as string | null, label: `Traveller ${t.index}` }));
        return (
          <div key={req.type} className="card space-y-2">
            <div>
              <h2 className="font-semibold">{req.label}</h2>
              <p className="text-sm text-slate-600">{req.description}</p>
            </div>
            {req.type === "passport_copy" && (
              <p className="text-sm">{view.travellers.length}/{a.travellerCount} passport(s) uploaded in the Travellers tab.</p>
            )}
            {req.type !== "passport_copy" && req.scope === "traveller" && view.travellers.length === 0 && (
              <p className="text-sm text-slate-500">Upload a passport first.</p>
            )}
            {slots.map((s) => {
              const doc = view.documents.find((d) => d.type === req.type && d.travellerId === s.id);
              return (
                <div key={String(s.id)} className="rounded-lg border border-slate-200 p-3">
                  {s.label && <div className="mb-1 text-xs font-medium text-slate-500">{s.label}</div>}
                  <input type="file" accept="image/jpeg,image/png,application/pdf" disabled={busy === `${req.type}:${s.id}`}
                    onChange={(e) => e.target.files?.[0] && upload(req, s.id, e.target.files[0])} />
                  {busy === `${req.type}:${s.id}` && <span className="ml-2 text-sm text-slate-500">Verifying...</span>}
                  {doc && (
                    <div className="mt-2 space-y-1 text-sm">
                      <div>Verdict: <Badge s={doc.verification.verdict} /> {!doc.verification.matchesExpectedType && <span className="text-red-700">(wrong document type)</span>}</div>
                      {doc.verification.issues.length > 0 && <ul className="list-disc pl-5 text-amber-800">{doc.verification.issues.map((i, n) => <li key={n}>{i}</li>)}</ul>}
                      <details className="text-xs text-slate-500"><summary>Extracted data</summary><pre className="overflow-x-auto">{JSON.stringify(doc.verification.extracted, null, 2)}</pre></details>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function ReadinessTab({ id, version }: { id: string; version: string }) {
  const [r, setR] = useState<Readiness | null>(null);
  useEffect(() => {
    let live = true;
    setR(null);
    fetch(`/api/applications/${id}/readiness`).then((x) => x.json()).then((d) => live && setR(d));
    return () => { live = false; };
  }, [id, version]);
  if (!r) return <p className="text-slate-500">Scoring...</p>;
  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <h2 className="text-lg font-semibold">How strong is your application?</h2>
        <div className="text-5xl font-bold text-indigo-700">{r.score}<span className="text-xl text-slate-400">/100</span> <span className="text-xl">{r.band}</span></div>
        <p>{r.narrative}</p>
        <h3 className="font-semibold">Top fixes</h3>
        {r.topFixes.length ? <ol className="list-decimal pl-5 text-sm">{r.topFixes.map((f, i) => <li key={i}>{f}</li>)}</ol> : <p className="text-sm">No outstanding fixes.</p>}
        <p className="text-sm font-medium text-slate-600">{r.disclaimer}</p>
      </div>
      <div className="card">
        <h3 className="mb-2 font-semibold">Rule results</h3>
        <ul className="space-y-1 text-sm">{r.ruleResults.map((x, i) => <li key={i}><Badge s={x.severity} /> {x.message}</li>)}</ul>
      </div>
    </div>
  );
}

function Forms({ view }: { view: View }) {
  const a = view.application;
  return (
    <div className="card space-y-3">
      <h2 className="font-semibold">Pre-filled application forms</h2>
      <p className="text-sm text-slate-600">Our own layout mirroring the field set of the {view.destination.visaType} form. Not an official form. Review every field.</p>
      {view.travellers.length === 0 && <p className="text-sm text-slate-500">Upload a passport to generate a form.</p>}
      {view.travellers.map((t) => (
        <div key={t.id}>
          <a className="btn-secondary" href={`/api/applications/${a.id}/travellers/${t.id}/form.pdf`} target="_blank" rel="noreferrer">
            Download PDF - traveller {t.index} ({t.passport.surname})
          </a>
        </div>
      ))}
    </div>
  );
}

function Review({ view, reload }: { view: View; reload: () => Promise<void> }) {
  const a = view.application;
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const cur = STATUSES.indexOf(a.status as (typeof STATUSES)[number]);
  const labels = ["Draft", "Documents", "Prepared", "Expert review (stub)", "Appointment (stub)"];

  async function addNote() {
    const res = await fetch(`/api/applications/${a.id}/notes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: note }) });
    if (res.ok) { setNote(""); await reload(); } else setErr((await res.json()).error);
  }
  async function advance() {
    const res = await fetch(`/api/applications/${a.id}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    if (!res.ok) setErr((await res.json()).error);
    await reload();
  }
  return (
    <div className="space-y-4">
      <div className="card">
        <h2 className="mb-3 font-semibold">Status timeline</h2>
        <ol className="flex flex-wrap gap-2">
          {labels.map((l, i) => (
            <li key={l} className={`rounded-full px-3 py-1 text-sm ${i <= cur ? "bg-indigo-600 text-white" : "bg-slate-200 text-slate-600"}`}>{i + 1}. {l}</li>
          ))}
        </ol>
        {cur < STATUSES.length - 1 && <button className="btn mt-3" onClick={advance}>Advance to: {labels[cur + 1]}</button>}
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      </div>
      <div className="card text-sm">
        <h2 className="mb-2 font-semibold">Summary</h2>
        <p>{view.destination.name}, {a.departureDate} to {a.returnDate}, {a.travellerCount} traveller(s).</p>
        <ul className="mt-2 list-disc pl-5">
          {view.travellers.map((t) => <li key={t.id}>Traveller {t.index}: {t.passport.givenNames} {t.passport.surname}, passport {t.passport.passportNumber}, expires {t.passport.expiryDate}</li>)}
        </ul>
        <p className="mt-2">Documents uploaded: {view.documents.length}. Readiness: {view.score.score}/100 ({view.score.band}). A guide, never a visa decision.</p>
      </div>
      <div className="card">
        <h2 className="mb-2 font-semibold">Request correction</h2>
        <textarea className="input" rows={3} placeholder="Describe what should be corrected before submission..." value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn mt-2" disabled={!note.trim()} onClick={addNote}>Save note</button>
        <ul className="mt-3 space-y-2 text-sm">{a.notes.map((n, i) => <li key={i} className="rounded bg-slate-100 p-2"><div className="text-xs text-slate-500">{n.at}</div>{n.text}</li>)}</ul>
      </div>
      <div className="card text-sm">
        <h2 className="font-semibold">Book appointment - coming soon</h2>
        <p className="text-slate-600">Appointment booking is not automated in this clone. Book through the official embassy or visa-centre channel and confirm current requirements there.</p>
      </div>
    </div>
  );
}

"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DesignDirection } from "@/lib/schema";

export default function NewSite({ initial }: { initial: { name: string; city: string; existingUrl: string; services: string } }) {
  const router = useRouter();
  const [f, setF] = useState({ name: initial.name, industry: "", city: initial.city, region: "", phone: "", email: "", hours: "", tone: "friendly and professional", existingUrl: initial.existingUrl, services: initial.services });
  const [dirs, setDirs] = useState<DesignDirection[] | null>(null);
  const [pick, setPick] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const business = () => ({
    name: f.name.trim(), industry: f.industry.trim(), city: f.city.trim(), region: f.region.trim(),
    phone: f.phone.trim() || undefined, email: f.email.trim() || undefined, hours: f.hours.trim() || undefined,
    tone: f.tone.trim() || undefined, existingUrl: f.existingUrl.trim() || undefined,
    services: f.services.split(/[,\n]/).map((s) => s.trim()).filter(Boolean),
  });
  const valid = () => { const b = business(); return b.name && b.industry && b.city && b.region && b.services.length >= 2 && b.services.length <= 8; };

  async function call(url: string, body: unknown) {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "Request failed");
    return j;
  }
  async function directions(e: React.FormEvent) {
    e.preventDefault(); setError(""); setBusy(true);
    try { const j = await call("/api/design-directions", { business: business() }); setDirs(j.directions); setPick(j.directions[0].id); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  async function build() {
    setError(""); setBusy(true);
    try { const j = await call("/api/sites", { business: business(), direction: dirs!.find((d) => d.id === pick) }); router.push(`/sites/${j.id}`); }
    catch (err) { setError((err as Error).message); setBusy(false); }
  }

  const fields: [string, string, string][] = [["name", "Business name", "Bright Spark Plumbing"], ["industry", "Trade / industry", "plumber"], ["city", "City", "Springfield"], ["region", "State / region", "IL"], ["phone", "Phone", "(217) 555-0142"], ["email", "Email", "hello@example.com"], ["hours", "Hours", "Mon-Fri 8am-6pm"], ["tone", "Tone", "friendly and professional"], ["existingUrl", "Existing website (optional)", "https://"]];
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Build a site</h1>
      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
      {!dirs ? (
        <form onSubmit={directions} className="card grid gap-4 sm:grid-cols-2">
          {fields.map(([k, label, ph]) => (
            <div key={k}><label className="label" htmlFor={k}>{label}</label><input id={k} className="input" placeholder={ph} value={(f as Record<string, string>)[k]} onChange={set(k)} /></div>
          ))}
          <div className="sm:col-span-2"><label className="label" htmlFor="services">Services (2-8, comma separated)</label><input id="services" className="input" placeholder="drain cleaning, water heater repair, pipe repair" value={f.services} onChange={set("services")} /></div>
          <div className="sm:col-span-2"><button className="btn" disabled={busy || !valid()}>{busy ? "Thinking..." : "Get design directions"}</button></div>
        </form>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            {dirs.map((d) => (
              <button key={d.id} onClick={() => setPick(d.id)} className={`card text-left ${pick === d.id ? "ring-2 ring-emerald-500" : ""}`}>
                <div className="mb-2 flex h-10 overflow-hidden rounded">{Object.values(d.palette).map((c, i) => <div key={i} className="flex-1" style={{ background: c }} />)}</div>
                <p className="font-semibold">{d.name}</p><p className="text-sm text-slate-600">{d.vibe}</p>
                <p className="mt-2 text-xs text-slate-500">{d.headingFont} / {d.bodyFont}</p><p className="mt-1 text-xs text-slate-500">{d.layoutNotes}</p>
              </button>
            ))}
          </div>
          <div className="flex gap-3"><button className="btn-ghost" onClick={() => setDirs(null)}>Back</button><button className="btn" onClick={build} disabled={busy}>{busy ? "Building..." : "Build"}</button></div>
        </div>
      )}
    </div>
  );
}

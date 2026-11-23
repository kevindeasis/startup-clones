"use client";
import { useState } from "react";
import { CATEGORIES, type Profile } from "@/lib/types";

const list = (s: string) => s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);

export function ProfileForm({ initial }: { initial: Profile }) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [categories, setCategories] = useState<string[]>(initial.categories);
  const [keywords, setKeywords] = useState(initial.keywords.join(", "));
  const [regions, setRegions] = useState(initial.regions.join(", "));
  const [minValue, setMin] = useState(String(initial.minValue));
  const [maxValue, setMax] = useState(String(initial.maxValue));
  const [certs, setCerts] = useState(initial.certifications.join(", "));
  const [bonding, setBonding] = useState(String(initial.bondingCapacity ?? ""));
  const [team, setTeam] = useState(initial.team.map((t) => `${t.name} | ${t.role}`).join("\n"));
  const [past, setPast] = useState(initial.pastBids.map((b) => `${b.title} | ${b.agency} | ${b.year} | ${b.outcome} | ${b.summary}`).join("\n"));
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    const body = {
      name,
      description,
      categories,
      keywords: list(keywords),
      regions: list(regions),
      minValue: Number(minValue),
      maxValue: Number(maxValue),
      certifications: list(certs),
      bondingCapacity: bonding ? Number(bonding) : undefined,
      team: team.split("\n").map((l) => l.split("|").map((x) => x.trim())).filter((p) => p[0]).map((p) => ({ name: p[0], role: p[1] ?? "" })),
      pastBids: past.split("\n").map((l) => l.split("|").map((x) => x.trim())).filter((p) => p[0]).map((p) => ({ title: p[0], agency: p[1] ?? "", year: Number(p[2]) || 2024, outcome: (["won", "lost", "pending"].includes(p[3]) ? p[3] : "pending") as "won" | "lost" | "pending", summary: p[4] ?? "" })),
    };
    const res = await fetch("/api/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();
    setMsg(res.ok ? "Saved. Signal fit scores were recomputed." : `Error: ${data.error}`);
    setBusy(false);
  }

  return (
    <form onSubmit={save} className="card form-grid">
      <label>Company name<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
      <label>Bonding capacity ($)<input type="number" value={bonding} onChange={(e) => setBonding(e.target.value)} /></label>
      <label className="full">What we sell<textarea style={{ fontFamily: "inherit", minHeight: 80 }} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      <div className="full">
        <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Categories</div>
        <div className="chips">
          {CATEGORIES.map((c) => (
            <label key={c} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <input type="checkbox" checked={categories.includes(c)} onChange={(e) => setCategories(e.target.checked ? [...categories, c] : categories.filter((x) => x !== c))} />
              {c}
            </label>
          ))}
        </div>
      </div>
      <label className="full">Keywords (comma separated)<input value={keywords} onChange={(e) => setKeywords(e.target.value)} /></label>
      <label className="full">Regions (comma separated; matched against the agency region)<input value={regions} onChange={(e) => setRegions(e.target.value)} /></label>
      <label>Min project value ($)<input type="number" value={minValue} onChange={(e) => setMin(e.target.value)} /></label>
      <label>Max project value ($)<input type="number" value={maxValue} onChange={(e) => setMax(e.target.value)} /></label>
      <label className="full">Certifications (comma separated)<input value={certs} onChange={(e) => setCerts(e.target.value)} /></label>
      <label className="full">Team (one per line: Name | Role)<textarea value={team} onChange={(e) => setTeam(e.target.value)} style={{ minHeight: 70 }} /></label>
      <label className="full">Past bids (one per line: title | agency | year | won/lost/pending | summary)<textarea value={past} onChange={(e) => setPast(e.target.value)} /></label>
      <div className="full"><button disabled={busy}>{busy ? "Saving..." : "Save profile"}</button> <span>{msg}</span></div>
    </form>
  );
}

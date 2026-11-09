"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { DESTINATIONS, NATIONALITIES } from "@/lib/destinations";

export default function NewApplicationForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const [dest, setDest] = useState(sp.get("destination") || "HR");
  const [nationality, setNationality] = useState("EG");
  const [departureDate, setDeparture] = useState("2026-12-10");
  const [returnDate, setReturn] = useState("2026-12-20");
  const [travellerCount, setCount] = useState(1);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const d = DESTINATIONS.find((x) => x.code === dest)!;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    const res = await fetch("/api/applications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ destinationCode: dest, nationality, purpose: "tourism", departureDate, returnDate, travellerCount }),
    });
    const data = await res.json();
    if (res.ok) router.push(`/apply/${data.id}`);
    else { setError(data.error + (data.details ? ": " + data.details.map((x: { message: string }) => x.message).join(", ") : "")); setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="card mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-bold">Start an application</h1>
      <div>
        <label className="label" htmlFor="dest">Destination</label>
        <select id="dest" className="input" value={dest} onChange={(e) => setDest(e.target.value)}>
          {DESTINATIONS.map((x) => <option key={x.code} value={x.code}>{x.name} - {x.visaType}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label" htmlFor="nat">Nationality</label>
          <select id="nat" className="input" value={nationality} onChange={(e) => setNationality(e.target.value)}>
            {NATIONALITIES.map((n) => <option key={n.code} value={n.code}>{n.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="cnt">Travellers (1-5)</label>
          <input id="cnt" type="number" min={1} max={5} className="input" value={travellerCount} onChange={(e) => setCount(Number(e.target.value))} />
        </div>
        <div>
          <label className="label" htmlFor="dep">Departure</label>
          <input id="dep" type="date" className="input" value={departureDate} onChange={(e) => setDeparture(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="ret">Return</label>
          <input id="ret" type="date" className="input" value={returnDate} onChange={(e) => setReturn(e.target.value)} required />
        </div>
      </div>
      <div>
        <span className="label">Purpose</span>
        <div className="input bg-slate-100">Tourism</div>
      </div>
      <p className="text-sm text-slate-600">
        Illustrative service fee: <b>${d.feeUSD * travellerCount}</b> (${d.feeUSD} x {travellerCount}). {d.note}
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button className="btn w-full" disabled={busy}>{busy ? "Creating..." : "Create application"}</button>
    </form>
  );
}

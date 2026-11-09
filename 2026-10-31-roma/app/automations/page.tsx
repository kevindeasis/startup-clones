"use client";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { api } from "@/components/api";

type Auto = { id: string; name: string; instruction: string; cron: string; enabled: boolean; lastRunAt: string | null };
type Run = { id: string; startedAt: string; resultText: string | null; createdItemIds: string[] };
const PRESETS = ["every minute", "every morning at 8", "every weekday at 9", "every saturday", "every sunday evening", "every monday morning"];

export default function Automations() {
  const [autos, setAutos] = useState<Auto[]>([]);
  const [runs, setRuns] = useState<Record<string, Run[]>>({});
  const [f, setF] = useState({ name: "", instruction: "", cron: "every morning at 8" });
  const [msg, setMsg] = useState("");

  const load = async () => {
    const r = await api<{ automations: Auto[] }>("/api/automations");
    setAutos(r.automations);
    const out: Record<string, Run[]> = {};
    await Promise.all(r.automations.map(async (a) => { out[a.id] = (await api<{ runs: Run[] }>(`/api/automations/${a.id}/runs`)).runs; }));
    setRuns(out);
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/set-state-in-effect

  async function add(e: React.FormEvent) {
    e.preventDefault(); setMsg("");
    try { await api("/api/automations", { body: f }); setF({ ...f, name: "", instruction: "" }); load(); } catch (err) { setMsg(String(err)); }
  }
  return (
    <Shell active="automations">
      <div className="p-4">
        <h1 className="mb-3 text-xl font-semibold">Automations</h1>
        <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-stone-100 text-xs uppercase text-stone-500"><tr><th className="p-2">Name</th><th className="p-2">Instruction</th><th className="p-2">Cron</th><th className="p-2">Enabled</th><th className="p-2">Last run</th><th className="p-2" /></tr></thead>
            <tbody>
              {autos.map((a) => (
                <tr key={a.id} className="border-t border-stone-200 align-top">
                  <td className="p-2 font-medium">{a.name}</td><td className="p-2">{a.instruction}</td><td className="p-2 font-mono text-xs">{a.cron}</td>
                  <td className="p-2"><input type="checkbox" checked={a.enabled} onChange={async (e) => { await api(`/api/automations/${a.id}`, { method: "PATCH", body: { enabled: e.target.checked } }); load(); }} aria-label="Enabled" /></td>
                  <td className="p-2 text-xs">{a.lastRunAt?.slice(0, 19).replace("T", " ") ?? "never"}</td>
                  <td className="space-x-1 p-2 whitespace-nowrap">
                    <button onClick={async () => { await api(`/api/automations/${a.id}/run`, { method: "POST" }); load(); }} className="rounded border border-stone-300 px-2 py-1">Run now</button>
                    <button onClick={async () => { await api(`/api/automations/${a.id}`, { method: "DELETE" }); load(); }} className="rounded border border-red-300 px-2 py-1 text-red-700">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form onSubmit={add} className="mt-4 grid max-w-xl gap-2 rounded-lg border border-stone-200 bg-white p-3">
          <h2 className="font-medium">Add automation</h2>
          <input required placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="rounded border border-stone-300 px-2 py-1 text-sm" />
          <input required placeholder="Instruction (e.g. create a task water the plants)" value={f.instruction} onChange={(e) => setF({ ...f, instruction: e.target.value })} className="rounded border border-stone-300 px-2 py-1 text-sm" />
          <div className="flex gap-2">
            <select onChange={(e) => e.target.value && setF({ ...f, cron: e.target.value })} className="rounded border border-stone-300 px-2 py-1 text-sm" defaultValue="">
              <option value="">Preset...</option>{PRESETS.map((p) => <option key={p}>{p}</option>)}
            </select>
            <input required value={f.cron} onChange={(e) => setF({ ...f, cron: e.target.value })} placeholder="cron or preset" className="min-w-0 flex-1 rounded border border-stone-300 px-2 py-1 font-mono text-sm" />
          </div>
          {msg && <p className="text-sm text-red-700">{msg}</p>}
          <button className="w-fit rounded bg-stone-900 px-3 py-1.5 text-sm text-white">Add</button>
        </form>
        <h2 className="mb-2 mt-6 font-medium">Recent runs</h2>
        <div className="space-y-3">
          {autos.map((a) => (
            <div key={a.id} className="rounded-lg border border-stone-200 bg-white p-3 text-sm">
              <div className="font-medium">{a.name}</div>
              {(runs[a.id] ?? []).length === 0 && <div className="text-xs text-stone-500">No runs yet.</div>}
              {(runs[a.id] ?? []).map((r) => <div key={r.id} className="mt-1 text-xs text-stone-600"><span className="font-mono">{r.startedAt.slice(0, 19).replace("T", " ")}</span> - {r.resultText} ({r.createdItemIds.length} created)</div>)}
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}

"use client";

import { useState } from "react";
import { Button, Card, fmt, inputClass, pct } from "./ui";
import { useFetch } from "./use-fetch";
import type { funnelResults, goalResults } from "@/lib/funnels";
import type { Funnel, Step } from "@/lib/types";

type FunnelRes = ReturnType<typeof funnelResults>;
type GoalRes = ReturnType<typeof goalResults>;

const post = (url: string, body: unknown) => fetch(url, { method: "POST", body: JSON.stringify(body) });

function FunnelCard({ siteId, funnel, range, onDelete }: { siteId: string; funnel: Funnel; range: string; onDelete: () => void }) {
  const res = useFetch<FunnelRes>(`/api/sites/${siteId}/funnels/${funnel.id}/results?range=${range}`);
  const top = res.data?.steps[0]?.count || 1;
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-medium">{funnel.name}</h3>
        <button onClick={onDelete} className="text-xs text-red-600 hover:underline">Delete</button>
      </div>
      {res.data?.steps.map((s, i) => (
        <div key={i} className="mb-2" data-testid="funnel-step">
          <div className="flex justify-between text-sm">
            <span>{i + 1}. {s.kind === "path" ? `Page ${s.value}` : `Event ${s.value}`}</span>
            <span className="tabular-nums">{fmt(s.count)} sessions{i > 0 && ` (${pct(s.fromPrevious)} of previous)`}</span>
          </div>
          <div className="mt-1 h-3 rounded bg-zinc-100">
            <div className="h-3 rounded bg-[var(--accent)]" style={{ width: `${(s.count / top) * 100}%` }} />
          </div>
        </div>
      ))}
      {res.data && <p className="mt-2 text-sm">Overall conversion: <strong>{pct(res.data.overall)}</strong></p>}
    </Card>
  );
}

function NewFunnelForm({ siteId, onCreated }: { siteId: string; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [steps, setSteps] = useState<Step[]>([{ kind: "path", value: "/" }, { kind: "event", value: "signup" }]);
  const [error, setError] = useState("");

  const update = (i: number, patch: Partial<Step>) => setSteps(steps.map((s, j) => (i === j ? { ...s, ...patch } : s)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await post(`/api/sites/${siteId}/funnels`, { name, steps });
    if (!res.ok) return setError((await res.json()).error);
    setError("");
    setName("");
    onCreated();
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Funnel name" required className={`${inputClass} w-full`} />
      {steps.map((s, i) => (
        <div key={i} className="flex gap-2">
          <select value={s.kind} onChange={(e) => update(i, { kind: e.target.value as Step["kind"] })} className={inputClass} aria-label={`Step ${i + 1} kind`}>
            <option value="path">Page path</option>
            <option value="event">Event</option>
          </select>
          <input value={s.value} onChange={(e) => update(i, { value: e.target.value })} required className={`${inputClass} flex-1`} aria-label={`Step ${i + 1} value`} />
          {steps.length > 2 && <button type="button" onClick={() => setSteps(steps.filter((_, j) => j !== i))} className="text-sm text-red-600">x</button>}
        </div>
      ))}
      <div className="flex gap-2">
        {steps.length < 5 && <button type="button" onClick={() => setSteps([...steps, { kind: "path", value: "" }])} className="text-sm text-[var(--accent)]">+ Add step</button>}
        <Button type="submit" className="ml-auto">Create funnel</Button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}

function Goals({ siteId, range }: { siteId: string; range: string }) {
  const goals = useFetch<GoalRes>(`/api/sites/${siteId}/goals?range=${range}`);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("event");
  const [target, setTarget] = useState("");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    await post(`/api/sites/${siteId}/goals`, { name, kind, target });
    setName("");
    setTarget("");
    goals.reload();
  }

  async function remove(id: string) {
    await fetch(`/api/sites/${siteId}/goals/${id}`, { method: "DELETE" });
    goals.reload();
  }

  return (
    <Card title="Goals">
      <table className="mb-4 w-full text-sm">
        <thead className="text-left text-[var(--muted)]">
          <tr><th>Goal</th><th>Target</th><th className="text-right">Conversions</th><th className="text-right">Rate</th><th /></tr>
        </thead>
        <tbody>
          {goals.data?.map((g) => (
            <tr key={g.id} className="border-t border-[var(--line)]">
              <td className="py-1.5">{g.name}</td>
              <td><code>{g.kind}: {g.target}</code></td>
              <td className="text-right tabular-nums">{fmt(g.conversions)}</td>
              <td className="text-right tabular-nums">{pct(g.rate)}</td>
              <td className="text-right"><button onClick={() => remove(g.id)} className="text-xs text-red-600">Delete</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <form onSubmit={add} className="flex flex-wrap gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Goal name" required className={inputClass} />
        <select value={kind} onChange={(e) => setKind(e.target.value)} className={inputClass} aria-label="Goal kind">
          <option value="event">Event</option>
          <option value="path">Page path</option>
        </select>
        <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="signup or /pricing" required className={inputClass} />
        <Button type="submit">Add goal</Button>
      </form>
    </Card>
  );
}

export function FunnelsClient({ siteId }: { siteId: string }) {
  const [range, setRange] = useState("30d");
  const funnels = useFetch<Funnel[]>(`/api/sites/${siteId}/funnels`);

  async function remove(id: string) {
    await fetch(`/api/sites/${siteId}/funnels/${id}`, { method: "DELETE" });
    funnels.reload();
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <select value={range} onChange={(e) => setRange(e.target.value)} className={inputClass} aria-label="Date range">
          <option value="24h">Last 24 hours</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </select>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          {funnels.data?.map((f) => <FunnelCard key={f.id} siteId={siteId} funnel={f} range={range} onDelete={() => remove(f.id)} />)}
          {funnels.data?.length === 0 && <p className="text-sm text-[var(--muted)]">No funnels yet.</p>}
        </div>
        <div className="space-y-4">
          <Card title="New funnel (2-5 steps, in order)"><NewFunnelForm siteId={siteId} onCreated={funnels.reload} /></Card>
          <Goals siteId={siteId} range={range} />
        </div>
      </div>
    </div>
  );
}

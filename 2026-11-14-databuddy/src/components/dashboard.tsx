"use client";

import { useState } from "react";
import { TimeSeries } from "./charts";
import { Card, fmt, inputClass, pct } from "./ui";
import { useFetch } from "./use-fetch";
import type { getRealtime, getStats } from "@/lib/stats";

type Stats = ReturnType<typeof getStats>;
type Realtime = ReturnType<typeof getRealtime>;
type Item = { label: string; value: number; sub?: string };

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div data-testid="tile" className="rounded-xl border border-[var(--line)] bg-white p-4">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function TopList({ title, items, unit }: { title: string; items: Item[]; unit: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <Card title={title}>
      {items.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No data yet.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((i) => (
            <li key={i.label} className="relative text-sm">
              <div className="absolute inset-y-0 left-0 rounded bg-indigo-100" style={{ width: `${(i.value / max) * 100}%` }} />
              <div className="relative flex justify-between gap-2 px-2 py-1">
                <span className="truncate">{i.label}</span>
                <span className="tabular-nums text-[var(--muted)]" title={unit}>{fmt(i.value)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const named = (rows: { name: string; visitors: number }[]): Item[] => rows.map((r) => ({ label: r.name, value: r.visitors }));

export function Dashboard({ siteId }: { siteId: string }) {
  const [range, setRange] = useState("30d");
  const stats = useFetch<Stats>(`/api/sites/${siteId}/stats?range=${range}`);
  const live = useFetch<Realtime>(`/api/sites/${siteId}/realtime`, 10_000);
  const s = stats.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-sm" data-testid="realtime">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
          <strong>{live.data?.visitors ?? "-"}</strong> visitors right now
        </p>
        <select value={range} onChange={(e) => setRange(e.target.value)} className={inputClass} aria-label="Date range">
          <option value="24h">Last 24 hours</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </select>
      </div>
      {stats.error && <p className="text-sm text-red-600">{stats.error}</p>}
      {!s ? (
        <p className="text-sm text-[var(--muted)]">Loading...</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
            <Tile label="Visitors" value={fmt(s.visitors)} />
            <Tile label="Pageviews" value={fmt(s.pageviews)} />
            <Tile label="Sessions" value={fmt(s.sessions)} />
            <Tile label="Bounce rate" value={pct(s.bounceRate)} />
            <Tile label="Pages / session" value={fmt(s.pagesPerSession, 2)} />
            <Tile label="JS errors" value={fmt(s.errors)} />
          </div>
          <Card title={s.bucket === "hour" ? "Traffic per hour" : "Traffic per day"}>
            <TimeSeries data={s.series} bucket={s.bucket} />
          </Card>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <TopList title="Top pages" unit="pageviews" items={s.topPages.map((p) => ({ label: p.path, value: p.pageviews }))} />
            <TopList title="Top referrers" unit="visitors" items={s.topReferrers.map((r) => ({ label: r.host, value: r.visitors }))} />
            <TopList title="UTM sources" unit="visitors" items={named(s.topUtmSources)} />
            <TopList title="UTM campaigns" unit="visitors" items={named(s.topUtmCampaigns)} />
            <TopList title="Countries" unit="visitors" items={named(s.countries)} />
            <TopList title="Browsers" unit="visitors" items={named(s.browsers)} />
            <TopList title="Devices" unit="visitors" items={named(s.devices)} />
            <Card title="Recent errors" className="lg:col-span-2">
              {s.recentErrors.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">No errors in this period.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {s.recentErrors.map((e) => (
                    <li key={`${e.name}${e.path}`} className="flex justify-between gap-3">
                      <span className="truncate"><code>{e.name}</code> <span className="text-[var(--muted)]">on {e.path}</span></span>
                      <span className="tabular-nums">{e.count}x</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

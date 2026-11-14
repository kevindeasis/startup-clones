"use client";

import { useSyncExternalStore } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ChartSpec } from "@/lib/types";

const subscribe = () => () => {};
/** False during SSR and hydration, true afterwards: recharts is only rendered on the client. */
const useMounted = () => useSyncExternalStore(subscribe, () => true, () => false);

function ChartFrame({ children }: { children: React.ReactElement }) {
  const mounted = useMounted();
  return <div className="h-64 w-full">{mounted ? <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer> : null}</div>;
}

const COLORS = { primary: "#4f46e5", secondary: "#0d9488" };

export function TimeSeries({ data, bucket }: { data: { t: string; visitors: number; pageviews: number }[]; bucket: "hour" | "day" }) {
  const label = (t: string) => (bucket === "hour" ? `${t.slice(11, 13)}:00` : t.slice(5));
  return (
    <ChartFrame>
      <LineChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid stroke="#e5e7eb" vertical={false} />
        <XAxis dataKey="t" tickFormatter={label} fontSize={12} minTickGap={24} />
        <YAxis fontSize={12} width={40} />
        <Tooltip labelFormatter={(t) => String(t)} />
        <Legend />
        <Line type="monotone" dataKey="pageviews" stroke={COLORS.secondary} dot={false} strokeWidth={2} />
        <Line type="monotone" dataKey="visitors" stroke={COLORS.primary} dot={false} strokeWidth={2} />
      </LineChart>
    </ChartFrame>
  );
}

export function ResultChart({ chart, rows }: { chart: ChartSpec; rows: Record<string, unknown>[] }) {
  const data = rows.map((r) => ({ ...r, [chart.y]: Number(r[chart.y]) }));
  return (
    <div>
      {chart.title && <p className="mb-1 text-sm font-medium">{chart.title}</p>}
      <ChartFrame>
        {chart.type === "line" ? (
          <LineChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
            <CartesianGrid stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey={chart.x} fontSize={12} minTickGap={24} />
            <YAxis fontSize={12} width={40} />
            <Tooltip />
            <Line type="monotone" dataKey={chart.y} stroke={COLORS.primary} dot={false} strokeWidth={2} />
          </LineChart>
        ) : (
          <BarChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
            <CartesianGrid stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey={chart.x} fontSize={12} interval={0} tickFormatter={(v) => String(v).slice(0, 14)} />
            <YAxis fontSize={12} width={40} />
            <Tooltip />
            <Bar dataKey={chart.y} fill={COLORS.primary} radius={[4, 4, 0, 0]} />
          </BarChart>
        )}
      </ChartFrame>
    </div>
  );
}

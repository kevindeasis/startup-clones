"use client";

import { useState } from "react";
import { Markdown } from "./markdown";
import { Button, Card, fmt } from "./ui";
import { useFetch } from "./use-fetch";
import type { InsightRow } from "@/lib/monitor";

export function InsightsClient({ siteId }: { siteId: string }) {
  const list = useFetch<InsightRow[]>(`/api/sites/${siteId}/insights`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/sites/${siteId}/monitor`, { method: "POST" });
    if (!res.ok) setError((await res.json()).error);
    setBusy(false);
    list.reload();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--muted)]">Compares the last 7 full days with the 7 before and writes a digest.</p>
        <Button onClick={run} disabled={busy}>{busy ? "Checking..." : "Run check now"}</Button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {list.data?.length === 0 && <p className="text-sm text-[var(--muted)]">No checks yet.</p>}
      {list.data?.map((i) => (
        <Card key={i.id}>
          <p className="mb-2 text-xs text-[var(--muted)]">
            {i.created_at} {i.sent_to_slack && <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-800">sent to Slack</span>}
          </p>
          <Markdown text={i.digest_md} />
          {i.changes.length > 0 && (
            <table className="mt-3 w-full text-sm">
              <thead className="text-left text-[var(--muted)]"><tr><th>Change</th><th className="text-right">Previous</th><th className="text-right">Current</th><th className="text-right">Delta</th></tr></thead>
              <tbody>
                {i.changes.map((c, j) => (
                  <tr key={j} className="border-t border-[var(--line)]">
                    <td className="py-1">{c.label} <span className="text-xs text-[var(--muted)]">{c.kind}</span></td>
                    <td className="text-right tabular-nums">{fmt(c.previous, 1)}</td>
                    <td className="text-right tabular-nums">{fmt(c.current, 1)}</td>
                    <td className="text-right tabular-nums">{c.deltaPct >= 0 ? "+" : ""}{c.deltaPct.toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ))}
    </div>
  );
}

"use client";

import { useState } from "react";
import { Card, Button } from "./ui";
import { useFetch } from "./use-fetch";
import type { getRealtime } from "@/lib/stats";

type Realtime = ReturnType<typeof getRealtime>;

export function SetupClient({ siteId, origin }: { siteId: string; origin: string }) {
  const snippet = `<script defer src="${origin}/track.js" data-site="${siteId}"></script>`;
  const [copied, setCopied] = useState(false);
  const [sent, setSent] = useState(false);
  const live = useFetch<Realtime>(`/api/sites/${siteId}/realtime`, 3000);

  async function copy() {
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
  }

  async function sendTest() {
    await fetch("/api/collect", {
      method: "POST",
      body: JSON.stringify({ site: siteId, type: "pageview", path: "/setup-test", referrer: "" }),
    });
    setSent(true);
    live.reload();
  }

  return (
    <div className="space-y-4">
      <Card title="1. Add the script to your site">
        <pre className="overflow-x-auto rounded-lg bg-zinc-900 p-3 text-xs text-zinc-100">{snippet}</pre>
        <Button className="mt-3" onClick={copy}>{copied ? "Copied" : "Copy snippet"}</Button>
      </Card>
      <Card title="2. Track custom events (optional)">
        <pre className="overflow-x-auto rounded-lg bg-zinc-900 p-3 text-xs text-zinc-100">{"window.hutch.track('signup', { plan: 'pro' })"}</pre>
      </Card>
      <Card title="3. Check that it works">
        <Button onClick={sendTest}>Send test event</Button>
        {sent && <p className="mt-2 text-sm text-emerald-700">Test pageview sent.</p>}
        <ul className="mt-3 space-y-1 text-sm" data-testid="live-events">
          {live.data?.events.map((e, i) => (
            <li key={i}>
              <code>{e.type}</code> {e.path} <span className="text-[var(--muted)]">{e.ts}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

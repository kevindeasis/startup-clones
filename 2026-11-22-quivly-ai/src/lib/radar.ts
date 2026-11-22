import type { Action, Signal } from "./types";
import { buildAction } from "./analyze";
import { buildCtx } from "./context";
import { classifySignal } from "./llm";
import { mutate, newId, readDb } from "./store";
import { iso } from "./util";

export async function ingestSignal(input: { title: string; text: string; source: string; url?: string; publishedAt?: string }) {
  const db = readDb();
  const cls = await classifySignal(input, db.accounts);
  const known = new Set(db.accounts.map((a) => a.id));
  const accountIds = cls.accountIds.filter((id) => known.has(id));
  const relevant = cls.relevant && accountIds.length > 0;
  const signal: Signal = {
    id: newId("sig"), title: input.title, text: input.text, source: input.source,
    ...(input.url ? { url: input.url } : {}),
    publishedAt: input.publishedAt ?? iso(new Date()), relevant, accountIds: relevant ? accountIds : [],
    signalType: cls.signalType, direction: relevant ? cls.direction : "neutral", summary: cls.summary,
    suggestedPlay: relevant ? cls.suggestedPlay : "none", createdAt: new Date().toISOString(),
    ...(cls.degraded ? { degraded: true } : {}),
  };
  const actions: Action[] = [];
  if (relevant && (signal.direction === "expansion" || signal.direction === "risk")) {
    for (const accountId of signal.accountIds) {
      const ctx = buildCtx(db, accountId)!;
      actions.push(await buildAction({
        accountId, type: signal.direction === "expansion" ? "expansion" : "risk",
        priority: signal.direction === "risk" ? "high" : "medium",
        title: `Radar: ${signal.title}`,
        play: signal.suggestedPlay === "none" ? (signal.direction === "risk" ? "exec_check_in" : "expansion_project") : signal.suggestedPlay,
        evidence: { signalId: signal.id, signalTitle: signal.title, signalType: signal.signalType },
        dedupeKey: `signal:${signal.id}:${accountId}`,
      }, ctx));
    }
  }
  await mutate((d) => { d.signals.push(signal); d.actions.push(...actions); });
  return { signal, actions };
}

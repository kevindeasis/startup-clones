import type { Brief } from "./types";
import { analyze } from "./analyze";
import { buildCtx, renewalAsk } from "./context";
import { draftRenewalBrief } from "./llm";
import { mutate, newId, readDb } from "./store";

export async function createBrief(accountId: string): Promise<Brief> {
  let db = readDb();
  if (!db.accounts.find((a) => a.id === accountId)) throw new Error("account not found");
  if (!db.accounts.find((a) => a.id === accountId)?.health) { await analyze(accountId); db = readDb(); }
  const ctx = buildCtx(db, accountId)!;
  const ask = renewalAsk(ctx.account.arr, ctx.account.health?.score ?? 60, ctx.quotaPct);
  const res = await draftRenewalBrief(ctx, ask);
  const brief: Brief = {
    id: newId("brief"), accountId, createdAt: new Date().toISOString(), markdown: res.markdown, ask,
    ...(res.degraded ? { degraded: true } : {}),
  };
  await mutate((d) => { d.briefs.push(brief); });
  return brief;
}

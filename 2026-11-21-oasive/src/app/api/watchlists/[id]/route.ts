import { z } from "zod";
import { handle, json, readJson } from "@/lib/api";
import { ensureDefaultWatchlist, HttpError } from "@/lib/service";
import { store } from "@/lib/store";
import { applyWatchlistPatch, DEFAULT_WATCHLIST_ID } from "@/lib/watchlists";

export const dynamic = "force-dynamic";
const patch = z.object({ name: z.string().trim().min(1).max(80).optional(), add: z.array(z.string()).optional(), remove: z.array(z.string()).optional() });
type Ctx = { params: Promise<{ id: string }> };

export function PATCH(req: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const p = patch.parse(await readJson(req));
    const lists = await ensureDefaultWatchlist();
    const i = lists.findIndex((w) => w.id === id);
    if (i < 0) throw new HttpError(404, "Unknown watchlist");
    const valid = (await store.listObligors()).map((o) => o.id);
    lists[i] = applyWatchlistPatch(lists[i], p, valid);
    await store.saveWatchlists(lists);
    return json(lists[i]);
  });
}

export function DELETE(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (id === DEFAULT_WATCHLIST_ID) throw new HttpError(400, "The default watchlist cannot be deleted");
    const lists = await ensureDefaultWatchlist();
    if (!lists.some((w) => w.id === id)) throw new HttpError(404, "Unknown watchlist");
    await store.saveWatchlists(lists.filter((w) => w.id !== id));
    return json({ ok: true });
  });
}

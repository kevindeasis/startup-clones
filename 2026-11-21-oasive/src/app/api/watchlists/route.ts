import { z } from "zod";
import { handle, json, readJson } from "@/lib/api";
import { ensureDefaultWatchlist, watchlistDetails } from "@/lib/service";
import { store } from "@/lib/store";
import { uid } from "@/lib/text";

export const dynamic = "force-dynamic";
const body = z.object({ name: z.string().trim().min(1).max(80), obligorIds: z.array(z.string()).optional() });

export function GET() {
  return handle(async () => json({ watchlists: await watchlistDetails() }));
}

export function POST(req: Request) {
  return handle(async () => {
    const b = body.parse(await readJson(req));
    const lists = await ensureDefaultWatchlist();
    const valid = (await store.listObligors()).map((o) => o.id);
    const wl = { id: uid("wl"), name: b.name, obligorIds: (b.obligorIds ?? []).filter((id) => valid.includes(id)), createdAt: new Date().toISOString() };
    await store.saveWatchlists([...lists, wl]);
    return json(wl, 201);
  });
}

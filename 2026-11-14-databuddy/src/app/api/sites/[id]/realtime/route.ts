import { fail, json, siteFrom, type SiteCtx } from "@/lib/http";
import { getRealtime } from "@/lib/stats";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: SiteCtx) {
  const site = await siteFrom(ctx);
  return site ? json(getRealtime(site.id)) : fail("Site not found.", 404);
}

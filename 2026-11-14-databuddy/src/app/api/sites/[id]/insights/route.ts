import { fail, json, siteFrom, type SiteCtx } from "@/lib/http";
import { listInsights } from "@/lib/monitor";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: SiteCtx) {
  const site = await siteFrom(ctx);
  return site ? json(listInsights(site.id)) : fail("Site not found.", 404);
}

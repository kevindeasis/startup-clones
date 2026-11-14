import { fail, json, siteFrom, type SiteCtx } from "@/lib/http";
import { parseRange } from "@/lib/range";
import { getStats } from "@/lib/stats";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: SiteCtx) {
  const site = await siteFrom(ctx);
  if (!site) return fail("Site not found.", 404);
  return json(getStats(site.id, parseRange(new URL(req.url).searchParams.get("range"))));
}

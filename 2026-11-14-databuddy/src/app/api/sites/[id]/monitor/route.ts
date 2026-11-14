import { fail, json, siteFrom, type SiteCtx } from "@/lib/http";
import { runMonitor } from "@/lib/monitor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(_req: Request, ctx: SiteCtx) {
  const site = await siteFrom(ctx);
  return site ? json(await runMonitor(site.id, site.name)) : fail("Site not found.", 404);
}

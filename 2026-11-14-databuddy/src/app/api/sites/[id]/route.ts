import { fail, json, siteFrom, type SiteCtx } from "@/lib/http";
import { deleteSite } from "@/lib/repo";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: SiteCtx) {
  const site = await siteFrom(ctx);
  return site ? json(site) : fail("Site not found.", 404);
}

export async function DELETE(_req: Request, ctx: SiteCtx) {
  const site = await siteFrom(ctx);
  if (!site) return fail("Site not found.", 404);
  deleteSite(site.id);
  return json({ ok: true });
}

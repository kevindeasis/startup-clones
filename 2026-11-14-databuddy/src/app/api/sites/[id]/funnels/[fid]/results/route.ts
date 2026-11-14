import { fail, json, siteFrom } from "@/lib/http";
import { funnelResults } from "@/lib/funnels";
import { parseRange } from "@/lib/range";
import { getFunnel } from "@/lib/repo";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string; fid: string }> }) {
  const site = await siteFrom(ctx);
  const funnel = site && getFunnel(site.id, (await ctx.params).fid);
  if (!funnel) return fail("Funnel not found.", 404);
  return json(funnelResults(funnel, parseRange(new URL(req.url).searchParams.get("range"))));
}

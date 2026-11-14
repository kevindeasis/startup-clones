import { json, siteFrom } from "@/lib/http";
import { deleteFunnel } from "@/lib/repo";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; fid: string }> }) {
  const site = await siteFrom(ctx);
  if (site) deleteFunnel(site.id, (await ctx.params).fid);
  return json({ ok: true });
}

import { json, siteFrom } from "@/lib/http";
import { deleteGoal } from "@/lib/repo";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; gid: string }> }) {
  const site = await siteFrom(ctx);
  if (site) deleteGoal(site.id, (await ctx.params).gid);
  return json({ ok: true });
}

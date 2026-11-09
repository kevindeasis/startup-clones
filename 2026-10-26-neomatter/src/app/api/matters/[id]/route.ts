import { getMatter } from "@/lib/matters";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const data = getMatter(id);
  if (!data) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(data);
}

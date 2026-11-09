import { ActionBody } from "@/lib/schemas";
import { applyAction, getMatter } from "@/lib/matters";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let json: unknown;
  try { json = await req.json(); } catch { return Response.json({ error: "invalid JSON" }, { status: 400 }); }
  const parsed = ActionBody.safeParse(json);
  if (!parsed.success) return Response.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  const res = await applyAction(id, parsed.data);
  if (!res.ok) return Response.json({ error: res.error }, { status: 404 });
  return Response.json(getMatter(id));
}

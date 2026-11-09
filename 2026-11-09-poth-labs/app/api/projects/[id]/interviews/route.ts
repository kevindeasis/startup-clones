import { handle, json } from "@/lib/http";
import { createInterview } from "@/lib/service";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const b = await json(req);
  return handle(() => createInterview(Number(id), b.accountId ? Number(b.accountId) : null), 201);
}

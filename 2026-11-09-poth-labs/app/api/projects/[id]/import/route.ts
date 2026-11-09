import { handle, json } from "@/lib/http";
import { importData } from "@/lib/service";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const b = await json(req);
  return handle(() => importData(Number(id), b));
}

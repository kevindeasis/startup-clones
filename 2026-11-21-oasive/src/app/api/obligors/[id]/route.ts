import { handle, json } from "@/lib/api";
import { obligorDetail } from "@/lib/service";

export const dynamic = "force-dynamic";
export function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => json(await obligorDetail((await ctx.params).id)));
}

import { handle } from "@/lib/http";
import { getProjectView } from "@/lib/service";
export const dynamic = "force-dynamic";

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(() => getProjectView(Number(id)));
}

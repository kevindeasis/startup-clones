import { handle } from "@/lib/http";
import { getInterviewState } from "@/lib/service";
export const dynamic = "force-dynamic";

export async function GET(_: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  return handle(() => getInterviewState(token));
}

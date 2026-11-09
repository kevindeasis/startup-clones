import { handle } from "@/lib/http";
import { finishInterview } from "@/lib/service";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(_: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  return handle(() => finishInterview(token));
}

import { handle } from "@/lib/http";
import { runHypotheses } from "@/lib/service";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(async () => ({ hypotheses: await runHypotheses(Number(id)) }));
}

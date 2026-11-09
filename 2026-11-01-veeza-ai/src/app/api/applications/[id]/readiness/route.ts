import { buildView } from "@/lib/view";
import { readinessNarrative } from "@/lib/llm";
import { handleError, json } from "@/lib/http";
import { DISCLAIMER } from "@/lib/types";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const v = await buildView(id);
    if (!v) return json({ error: "Not found" }, 404);
    const narrative = await readinessNarrative({
      destination: v.dest, score: v.score, band: v.band, fixes: v.fixes, results: v.results,
    });
    return json({ score: v.score, band: v.band, ruleResults: v.results, narrative, topFixes: v.fixes, disclaimer: DISCLAIMER });
  } catch (e) {
    return handleError(e);
  }
}

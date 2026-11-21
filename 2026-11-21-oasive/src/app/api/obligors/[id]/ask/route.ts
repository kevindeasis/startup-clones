import { z } from "zod";
import { handle, json, mode, readJson } from "@/lib/api";
import { askObligor } from "@/lib/service";

export const dynamic = "force-dynamic";
const body = z.object({ question: z.string().trim().min(3).max(1000) });

export function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    const { question } = body.parse(await readJson(req));
    const r = await askObligor(id, question);
    return json({ answer: r.answer, citations: r.citations, mode: mode() });
  });
}

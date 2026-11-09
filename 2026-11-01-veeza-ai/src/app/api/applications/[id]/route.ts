import { buildView } from "@/lib/view";
import { handleError, json } from "@/lib/http";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const view = await buildView(id);
    if (!view) return json({ error: "Not found" }, 404);
    return json(view.json);
  } catch (e) {
    return handleError(e);
  }
}

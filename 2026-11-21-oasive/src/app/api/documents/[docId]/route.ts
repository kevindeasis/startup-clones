import { handle, json } from "@/lib/api";
import { HttpError } from "@/lib/service";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";
export function GET(_req: Request, ctx: { params: Promise<{ docId: string }> }) {
  return handle(async () => {
    const doc = await store.getDocument((await ctx.params).docId);
    if (!doc) throw new HttpError(404, "Unknown document");
    const { chunks, ...rest } = doc;
    return json({ ...rest, chunkCount: chunks.length });
  });
}

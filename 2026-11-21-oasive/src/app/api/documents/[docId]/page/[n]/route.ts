import { handle, json } from "@/lib/api";
import { HttpError } from "@/lib/service";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";
export function GET(_req: Request, ctx: { params: Promise<{ docId: string; n: string }> }) {
  return handle(async () => {
    const { docId, n } = await ctx.params;
    const doc = await store.getDocument(docId);
    if (!doc) throw new HttpError(404, "Unknown document");
    const page = Number(n);
    if (!Number.isInteger(page) || page < 1 || page > doc.pageCount) throw new HttpError(404, "Unknown page");
    return json({ docId, docTitle: doc.title, page, pageCount: doc.pageCount, text: doc.pages[page - 1] });
  });
}

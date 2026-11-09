import { getApplication, getTraveller } from "@/lib/repo";
import { getDestination } from "@/lib/destinations";
import { buildFormPdf } from "@/lib/pdfform";
import { handleError, json } from "@/lib/http";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string; tid: string }> }) {
  try {
    const { id, tid } = await ctx.params;
    const app = await getApplication(id);
    const t = await getTraveller(tid);
    if (!app || !t || t.applicationId !== id) return json({ error: "Not found" }, 404);
    const buf = await buildFormPdf(app, getDestination(app.destinationCode)!, t);
    return new Response(new Uint8Array(buf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="visa-form-traveller-${t.index}.pdf"`,
      },
    });
  } catch (e) {
    return handleError(e);
  }
}

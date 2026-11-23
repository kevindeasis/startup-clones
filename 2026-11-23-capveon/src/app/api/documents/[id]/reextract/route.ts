import { getDocument, listSignals } from "@/lib/data";
import { fail, handle, json, type Ctx } from "@/lib/http";
import { runExtraction } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const POST = (_req: Request, { params }: Ctx) =>
  handle(async () => {
    const { id } = await params;
    if (!(await getDocument(id))) return fail(404, "Document not found");
    const doc = await runExtraction(id);
    const signals = (await listSignals()).filter((s) => s.sources.some((x) => x.documentId === id));
    return json({ ...doc, signals });
  });

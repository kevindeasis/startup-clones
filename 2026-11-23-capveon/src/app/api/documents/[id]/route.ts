import { getDocument, listDocuments, listSignals } from "@/lib/data";
import { fail, handle, json, type Ctx } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = (_req: Request, { params }: Ctx) =>
  handle(async () => {
    const { id } = await params;
    const doc = await getDocument(id);
    if (!doc) return fail(404, "Document not found");
    const signals = (await listSignals()).filter((s) => s.sources.some((x) => x.documentId === id));
    const addenda = (await listDocuments()).filter((d) => d.parentDocumentId === id).map((d) => ({ id: d.id, title: d.title, date: d.date }));
    return json({ ...doc, signals, addenda });
  });

import { agencyMap, listDocuments, listSignals } from "@/lib/data";
import { handle, json, readJson, fail } from "@/lib/http";
import { ingestDocument } from "@/lib/pipeline";
import { documentInputSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const GET = () =>
  handle(async () => {
    const [docs, agencies, signals] = await Promise.all([listDocuments(), agencyMap(), listSignals()]);
    return json({
      documents: docs
        .map((d) => ({
          id: d.id,
          title: d.title,
          agencyId: d.agencyId,
          agencyName: agencies.get(d.agencyId)?.name ?? d.agencyId,
          kind: d.kind,
          date: d.date,
          pages: d.pages.length,
          signals: signals.filter((s) => s.sources.some((x) => x.documentId === d.id)).length,
          status: d.status,
          parentDocumentId: d.parentDocumentId,
        }))
        .sort((a, b) => b.date.localeCompare(a.date)),
    });
  });

async function fileToText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  const buf = Buffer.from(await file.arrayBuffer());
  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    try {
      const res = await parser.getText();
      return res.pages.map((p) => p.text).join("\f");
    } finally {
      await parser.destroy();
    }
  }
  if (!/\.(txt|md|markdown)$/.test(name) && file.type && !file.type.startsWith("text/")) {
    throw new Error("Unsupported file type; upload .txt, .md or .pdf");
  }
  return buf.toString("utf8");
}

export const POST = (req: Request) =>
  handle(async () => {
    let raw: Record<string, unknown>;
    const ctype = req.headers.get("content-type") || "";
    if (ctype.includes("multipart/form-data")) {
      const form = await req.formData();
      raw = {};
      for (const [k, v] of form.entries()) if (typeof v === "string" && v !== "") raw[k] = v;
      const file = form.get("file");
      if (file instanceof File && file.size > 0) {
        try {
          raw.text = await fileToText(file);
        } catch (e) {
          return fail(400, e instanceof Error ? e.message : "Could not read file");
        }
      }
    } else {
      raw = (await readJson(req)) as Record<string, unknown>;
    }
    const input = documentInputSchema.parse(raw);
    const doc = await ingestDocument(input);
    const signals = (await listSignals()).filter((s) => s.sources.some((x) => x.documentId === doc.id));
    return json({ ...doc, signals }, doc.status === "failed" ? 422 : 201);
  });

import { extractText, getDocumentProxy } from "unpdf";

export const runtime = "nodejs";

/** Extracts text from an uploaded PDF (unpdf) or .txt file, without storing it. */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "file required" }, { status: 400 });
  try {
    if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
      const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
      const { text, totalPages } = await extractText(pdf, { mergePages: true });
      return Response.json({ text, pages: totalPages });
    }
    return Response.json({ text: await file.text() });
  } catch (e) {
    return Response.json({ error: `could not read file: ${(e as Error).message}` }, { status: 422 });
  }
}

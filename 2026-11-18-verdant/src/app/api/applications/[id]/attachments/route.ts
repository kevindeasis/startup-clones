import { extractText, getDocumentProxy } from "unpdf";
import { getApplication, saveApplication } from "@/lib/store";
import type { Attachment } from "@/lib/types";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

async function extractAttachmentText(file: File): Promise<{ text: string; pages?: number }> {
  if (file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
    const { text, totalPages } = await extractText(pdf, { mergePages: true });
    return { text, pages: totalPages };
  }
  return { text: await file.text() };
}

export async function POST(req: Request, { params }: Ctx) {
  const app = getApplication((await params).id);
  if (!app) return Response.json({ error: "not found" }, { status: 404 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "file required" }, { status: 400 });
  const kindRaw = String(form?.get("kind") ?? "other");
  const kind = (["site_plan", "floor_plan", "elevations", "other"].includes(kindRaw) ? kindRaw : "other") as Attachment["kind"];
  try {
    const { text, pages } = await extractAttachmentText(file);
    const att: Attachment = { id: `att-${Date.now()}`, filename: file.name, kind, text, pages };
    const saved = saveApplication({ ...app, attachments: [...app.attachments, att] });
    return Response.json({ attachment: att, application: saved }, { status: 201 });
  } catch (e) {
    return Response.json({ error: `could not read file: ${(e as Error).message}` }, { status: 422 });
  }
}

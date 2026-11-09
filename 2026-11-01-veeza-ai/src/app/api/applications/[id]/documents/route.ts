import { z } from "zod";
import { verifyDocument, type FileInput } from "@/lib/llm";
import { pdfText, STORE_LIMIT } from "@/lib/extract";
import { addDocument, getApplication, getTraveller, touch } from "@/lib/repo";
import { handleError, json } from "@/lib/http";
import { saveUpload, UploadError } from "@/lib/storage";
import { applyDocChecks } from "@/lib/rules";
import { getDestination } from "@/lib/destinations";
import { DOC_TYPES } from "@/lib/types";

const typeSchema = z.enum(DOC_TYPES);

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const app = await getApplication(id);
    if (!app) return json({ error: "Not found" }, 404);
    const dest = getDestination(app.destinationCode)!;
    const form = await req.formData();
    const type = typeSchema.parse(form.get("type"));
    const req_ = dest.docs.find((d) => d.type === type);
    if (!req_) return json({ error: `${type} is not required for ${dest.name}.` }, 400);
    const tidRaw = form.get("travellerId");
    const travellerId = typeof tidRaw === "string" && tidRaw ? tidRaw : null;
    let passport = null;
    if (travellerId) {
      const t = await getTraveller(travellerId);
      if (!t || t.applicationId !== id) return json({ error: "Unknown travellerId" }, 400);
      passport = t.passport;
    } else if (req_.scope === "traveller") {
      return json({ error: `travellerId is required for ${type}.` }, 400);
    }
    const file = form.get("file");
    if (!(file instanceof File)) throw new UploadError("Multipart field 'file' is required.");
    const saved = await saveUpload(id, file);

    let input: FileInput;
    let text = "";
    if (saved.mimeType === "application/pdf") {
      text = await pdfText(saved.buffer);
      input = { text };
    } else {
      input = { image: { data: saved.buffer, mediaType: saved.mimeType } };
    }
    const raw = await verifyDocument(type, input, {
      destination: dest, passport, departureDate: app.departureDate, returnDate: app.returnDate,
    });
    const verification = applyDocChecks(type, raw, { app, dest, passport });
    const row = await addDocument({
      applicationId: id, travellerId, type, filePath: saved.filePath, mimeType: saved.mimeType,
      extractedText: text.slice(0, STORE_LIMIT), verification: raw,
    });
    if (app.status === "draft") await touch(id, { status: "documents" });
    return json({ id: row.id, type, travellerId, verification }, 201);
  } catch (e) {
    return handleError(e);
  }
}

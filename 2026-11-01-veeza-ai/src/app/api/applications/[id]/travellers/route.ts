import { extractPassport, type FileInput } from "@/lib/llm";
import { pdfText } from "@/lib/extract";
import { addTraveller, getApplication, listTravellers, touch } from "@/lib/repo";
import { handleError, json } from "@/lib/http";
import { saveUpload, UploadError } from "@/lib/storage";
import { passportChecks } from "@/lib/rules";
import { getDestination } from "@/lib/destinations";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const app = await getApplication(id);
    if (!app) return json({ error: "Not found" }, 404);
    const existing = await listTravellers(id);
    if (existing.length >= app.travellerCount) {
      return json({ error: `This application is for ${app.travellerCount} traveller(s); all passports are already uploaded.` }, 409);
    }
    const form = await req.formData();
    const file = form.get("file") ?? form.get("passport");
    if (!(file instanceof File)) throw new UploadError("Multipart field 'file' is required.");
    const saved = await saveUpload(id, file);
    const input: FileInput =
      saved.mimeType === "application/pdf"
        ? { text: await pdfText(saved.buffer) }
        : { image: { data: saved.buffer, mediaType: saved.mimeType } };
    const result = await extractPassport(input);
    const used = new Set(existing.map((t) => t.index));
    let index = 1;
    while (used.has(index)) index++;
    const traveller = await addTraveller({
      applicationId: id, index, passport: result.fields, passportFile: saved.filePath, passportConfidence: result.confidence,
    });
    if (app.status === "draft") await touch(id, { status: "documents" });
    const dest = getDestination(app.destinationCode)!;
    const validity = passportChecks(result.fields, app.departureDate, dest, `Traveller ${index}`);
    return json({
      id: traveller.id, index, passport: result.fields, confidence: result.confidence,
      warnings: result.warnings, validity,
    }, 201);
  } catch (e) {
    return handleError(e);
  }
}

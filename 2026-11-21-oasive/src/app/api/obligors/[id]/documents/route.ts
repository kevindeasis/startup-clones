import { fail, handle, json } from "@/lib/api";
import { HttpError, ingestDocument } from "@/lib/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TYPES = ["audit", "official_statement", "budget", "board_minutes", "other"] as const;

export function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return fail(400, "Expected multipart/form-data");
    }
    const file = form.get("file");
    if (!(file instanceof File)) return fail(400, "Missing file field");
    const type = String(form.get("type") ?? "other") as (typeof TYPES)[number];
    if (!TYPES.includes(type)) return fail(400, `type must be one of ${TYPES.join(", ")}`);
    const fyRaw = String(form.get("fiscalYear") ?? "").trim();
    const fiscalYear = fyRaw ? Number(fyRaw) : undefined;
    if (fyRaw && !Number.isInteger(fiscalYear)) return fail(400, "fiscalYear must be an integer");
    if (file.size > 25 * 1024 * 1024) throw new HttpError(413, "File too large (25 MB max)");
    const result = await ingestDocument({
      obligorId: id, filename: file.name, buffer: Buffer.from(await file.arrayBuffer()), type, fiscalYear,
      title: String(form.get("title") ?? "") || undefined,
    });
    return json(result, 201);
  });
}

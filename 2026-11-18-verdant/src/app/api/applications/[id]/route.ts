import { z } from "zod";
import { getApplication, saveApplication } from "@/lib/store";

type Ctx = { params: Promise<{ id: string }> };

const patch = z.object({
  status: z.enum(["draft", "submitted", "in_review", "reviewed", "approved", "needs_info"]).optional(),
  projectDescription: z.string().optional(),
  fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export async function GET(_req: Request, { params }: Ctx) {
  const app = getApplication((await params).id);
  return app ? Response.json(app) : Response.json({ error: "not found" }, { status: 404 });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const app = getApplication((await params).id);
  if (!app) return Response.json({ error: "not found" }, { status: 404 });
  const parsed = patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });
  const d = parsed.data;
  return Response.json(
    saveApplication({ ...app, ...(d.status && { status: d.status }), ...(d.projectDescription && { projectDescription: d.projectDescription }), fields: { ...app.fields, ...d.fields } }),
  );
}

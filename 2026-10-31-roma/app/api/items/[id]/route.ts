import { z } from "zod";
import { json, body, err } from "@/lib/http";
import { applyUpdates, getItem, softDelete } from "@/lib/ops";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
export async function GET(_: Request, { params }: Ctx) {
  const it = getItem((await params).id);
  return it ? json(it) : err("Not found", 404);
}
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!getItem(id)) return err("Not found", 404);
  const b = await body(req, z.object({
    title: z.string().min(1).optional(), body: z.string().optional(), checked: z.boolean().optional(),
    dueDate: z.string().nullable().optional(), dueTime: z.string().nullable().optional(),
    listId: z.string().optional(), fields: z.record(z.string(), z.unknown()).optional(),
  }));
  if ("res" in b) return b.res;
  return json(applyUpdates([{ id, ...b.data }])[0]);
}
export async function DELETE(_: Request, { params }: Ctx) {
  const { id } = await params;
  if (!getItem(id)) return err("Not found", 404);
  softDelete([id]);
  return json(getItem(id));
}

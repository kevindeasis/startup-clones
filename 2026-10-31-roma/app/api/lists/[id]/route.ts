import { z } from "zod";
import { json, body, err } from "@/lib/http";
import { deleteList, getList, updateList } from "@/lib/ops";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!getList(id)) return err("Not found", 404);
  const b = await body(req, z.object({ name: z.string().min(1).optional(), fields: z.array(z.object({ name: z.string(), type: z.string().optional() })).optional() }));
  if ("res" in b) return b.res;
  return json(updateList(id, b.data));
}
export async function DELETE(_: Request, { params }: Ctx) {
  const { id } = await params;
  if (!deleteList(id)) return err("Only existing custom lists can be deleted", 400);
  return json({ ok: true });
}

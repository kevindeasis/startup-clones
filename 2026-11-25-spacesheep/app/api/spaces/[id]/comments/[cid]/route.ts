import { z } from "zod";
import { body, err, json } from "@/lib/api";
import { findSpace, saveSpace, withLock } from "@/lib/store";
export const dynamic = "force-dynamic";
const Schema = z.object({ resolved: z.boolean() });
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; cid: string }> }) {
  const { id, cid } = await params;
  const p = Schema.safeParse(await body(req));
  if (!p.success) return err("Invalid body");
  const s0 = findSpace(id);
  if (!s0) return err("Not found", 404);
  return withLock(s0.id, () => {
    const s = findSpace(s0.id)!;
    const c = s.comments.find((x) => x.id === cid);
    if (!c) return err("Comment not found", 404);
    c.resolved = p.data.resolved;
    saveSpace(s);
    return json(c);
  });
}

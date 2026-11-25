import { z } from "zod";
import { body, err, json } from "@/lib/api";
import { Comment, findSpace, now, saveSpace, uid, withLock } from "@/lib/store";
import { MENTION, runEdit } from "@/lib/editor";
import { hasBlock } from "@/lib/html";
import { currentVersion } from "@/lib/store";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Ctx) {
  const s = findSpace((await params).id);
  if (!s) return err("Not found", 404);
  return json(s.comments);
}

const Schema = z.object({ block: z.string().regex(/^b\d+$/).nullable().optional(), author: z.string().min(1).max(60), body: z.string().min(1).max(4000), parent_id: z.string().optional() });
export async function POST(req: Request, { params }: Ctx) {
  const p = Schema.safeParse(await body(req));
  if (!p.success) return err(p.error.issues.some((i) => i.path[0] === "block") ? "Invalid block id" : "Invalid body: author and body are required");
  const s0 = findSpace((await params).id);
  if (!s0) return err("Not found", 404);
  return withLock(s0.id, async () => {
    const s = findSpace(s0.id)!;
    if (p.data.block && !hasBlock(currentVersion(s).html, p.data.block)) return err("Unknown block", 400);
    const c: Comment = { id: uid(), block: p.data.block || null, author: p.data.author, body: p.data.body, created_at: now(), resolved: false, kind: "user", ...(p.data.parent_id ? { parent_id: p.data.parent_id } : {}) };
    s.comments.push(c);
    saveSpace(s);
    if (!MENTION.test(c.body)) return json({ comment: c, reply: null }, 201);
    try {
      const r = await runEdit(s, c);
      return json({ comment: c, reply: r.reply }, 201);
    } catch (e: any) {
      const reply: Comment = { id: uid(), block: c.block, author: "Paddock", kind: "agent", resolved: false, created_at: now(), parent_id: c.parent_id || c.id, body: `Sorry, the edit failed: ${e?.message || e}` };
      s.comments.push(reply);
      saveSpace(s);
      return json({ comment: c, reply, error: String(e?.message || e) }, 201);
    }
  });
}

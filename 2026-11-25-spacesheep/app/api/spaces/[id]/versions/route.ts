import { z } from "zod";
import { authed, body, err, json } from "@/lib/api";
import { findSpace, makeVersion, saveSpace, withLock } from "@/lib/store";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Ctx) {
  const s = findSpace((await params).id);
  if (!s) return err("Not found", 404);
  return json(s.versions.map(({ n, author, note, created_at }) => ({ n, author, note, created_at })));
}

const Schema = z.object({ html: z.string().min(1), note: z.string().optional() });
export async function POST(req: Request, { params }: Ctx) {
  if (!authed(req)) return err("Unauthorized", 401);
  const p = Schema.safeParse(await body(req));
  if (!p.success) return err("Invalid body");
  const s0 = findSpace((await params).id);
  if (!s0) return err("Not found", 404);
  return withLock(s0.id, () => {
    const s = findSpace(s0.id)!;
    const v = makeVersion(s, p.data.html, "agent", p.data.note || "");
    saveSpace(s);
    return json({ id: s.id, slug: s.slug, version: v.n }, 201);
  });
}

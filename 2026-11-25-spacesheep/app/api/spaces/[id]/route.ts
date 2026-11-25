import { z } from "zod";
import { body, err, json } from "@/lib/api";
import { currentVersion, findSpace, saveSpace, now, withLock } from "@/lib/store";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const s = findSpace(id);
  if (!s) return err("Not found", 404);
  const cur = currentVersion(s);
  const since = new URL(req.url).searchParams.get("since");
  if (since !== null) return json({ changed: cur.n !== Number(since), version: cur.n });
  const { versions, ...rest } = s;
  return json({ ...rest, version: cur.n, version_count: versions.length, html: cur.html });
}

const Patch = z.object({ title: z.string().min(1).optional(), visibility: z.enum(["private", "public"]).optional() });
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const p = Patch.safeParse(await body(req));
  if (!p.success) return err("Invalid body");
  const s0 = findSpace(id);
  if (!s0) return err("Not found", 404);
  return withLock(s0.id, () => {
    const s = findSpace(s0.id)!;
    if (p.data.title) s.title = p.data.title;
    if (p.data.visibility) s.visibility = p.data.visibility;
    s.updated_at = now();
    saveSpace(s);
    return json({ id: s.id, slug: s.slug, title: s.title, visibility: s.visibility });
  });
}

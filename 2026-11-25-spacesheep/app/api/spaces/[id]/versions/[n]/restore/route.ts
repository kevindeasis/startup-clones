import { body, err, json } from "@/lib/api";
import { findSpace, makeVersion, saveSpace, withLock } from "@/lib/store";
export const dynamic = "force-dynamic";
export async function POST(req: Request, { params }: { params: Promise<{ id: string; n: string }> }) {
  const { id, n } = await params;
  const s0 = findSpace(id);
  if (!s0) return err("Not found", 404);
  const b = await body<{ author?: string }>(req);
  return withLock(s0.id, () => {
    const s = findSpace(s0.id)!;
    const old = s.versions.find((x) => x.n === Number(n));
    if (!old) return err("Version not found", 404);
    const v = makeVersion(s, old.html, "restore", `restored version ${old.n}${b?.author ? " by " + b.author : ""}`);
    saveSpace(s);
    return json({ id: s.id, slug: s.slug, version: v.n, html: v.html }, 201);
  });
}

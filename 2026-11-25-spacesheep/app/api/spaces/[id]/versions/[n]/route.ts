import { err } from "@/lib/api";
import { findSpace } from "@/lib/store";
export const dynamic = "force-dynamic";
export async function GET(_: Request, { params }: { params: Promise<{ id: string; n: string }> }) {
  const { id, n } = await params;
  const s = findSpace(id);
  const v = s?.versions.find((x) => x.n === Number(n));
  if (!v) return err("Not found", 404);
  return new Response(v.html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

import { findSpace, currentVersion } from "@/lib/store";
export const dynamic = "force-dynamic";
export async function GET(_: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = findSpace(slug);
  if (!s) return new Response("Not found", { status: 404 });
  return new Response(currentVersion(s).html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

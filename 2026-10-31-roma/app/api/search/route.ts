import { json } from "@/lib/http";
import { searchItems } from "@/lib/ops";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return json({ items: q ? searchItems(q) : [] });
}

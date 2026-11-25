import { json } from "@/lib/api";
import { searchSpaces } from "@/lib/search";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const u = new URL(req.url);
  return json(searchSpaces(u.searchParams.get("q") || "", u.searchParams.get("all") === "1"));
}

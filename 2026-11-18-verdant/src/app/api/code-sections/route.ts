import { codeSections } from "@/lib/permits";
import { searchCode } from "@/lib/retrieval";

export function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q");
  return Response.json(q ? searchCode(q, 5) : codeSections);
}

import { json } from "@/lib/http";
import { getApprovals } from "@/lib/ops";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const status = new URL(req.url).searchParams.get("status") || undefined;
  return json({ approvals: getApprovals(status) });
}

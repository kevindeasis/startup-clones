import { json } from "@/lib/http";
import { getRuns } from "@/lib/automations";
export const dynamic = "force-dynamic";
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  return json({ runs: getRuns((await params).id) });
}

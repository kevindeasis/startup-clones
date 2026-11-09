import { json, err } from "@/lib/http";
import { runAutomation } from "@/lib/automations";
export const dynamic = "force-dynamic";
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const r = await runAutomation((await params).id);
  return r ? json(r) : err("Not found", 404);
}

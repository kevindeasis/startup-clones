import { json } from "@/lib/http";
import { getOutbox } from "@/lib/ops";
export const dynamic = "force-dynamic";
export async function GET() { return json({ outbox: getOutbox() }); }

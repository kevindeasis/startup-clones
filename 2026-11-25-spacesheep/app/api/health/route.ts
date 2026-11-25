import { json } from "@/lib/api";
import { MODEL, isMock } from "@/lib/editor";
export const dynamic = "force-dynamic";
export async function GET() { return json({ ok: true, mock: isMock(), model: MODEL }); }

import { json, mode } from "@/lib/api";

export const dynamic = "force-dynamic";
export function GET() {
  return json({ ok: true, mode: mode() });
}

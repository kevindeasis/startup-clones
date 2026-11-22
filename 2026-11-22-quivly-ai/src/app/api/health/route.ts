import { ok } from "@/lib/api";
import { readDb } from "@/lib/store";

export const dynamic = "force-dynamic";

export function GET() {
  const db = readDb();
  const counts = Object.fromEntries(Object.entries(db).map(([k, v]) => [k, v.length]));
  return ok({ ok: true, counts });
}

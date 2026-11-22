import { analyze } from "@/lib/analyze";
import { fail, ok } from "@/lib/api";
import { analyzeBody } from "@/lib/schemas";
import { readDb } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const text = await req.text();
  let raw: unknown = {};
  if (text.trim()) { try { raw = JSON.parse(text); } catch { return fail("body must be JSON"); } }
  const b = analyzeBody.safeParse(raw);
  if (!b.success) return fail("invalid body");
  if (b.data.accountId && !readDb().accounts.some((a) => a.id === b.data.accountId)) return fail("account not found", 404);
  return ok(await analyze(b.data.accountId));
}

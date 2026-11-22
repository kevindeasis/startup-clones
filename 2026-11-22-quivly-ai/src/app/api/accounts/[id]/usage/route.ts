import { analyze } from "@/lib/analyze";
import { fail, ok } from "@/lib/api";
import { readDb } from "@/lib/store";
import { parseUsageInput, upsertUsage } from "@/lib/usage";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!readDb().accounts.some((a) => a.id === id)) return fail("account not found", 404);
  const parsed = parseUsageInput(await req.text(), req.headers.get("content-type") ?? "");
  if ("error" in parsed) return fail(parsed.error);
  const ingested = await upsertUsage(id, parsed.rows);
  const { newActions } = await analyze(id);
  const health = readDb().accounts.find((a) => a.id === id)?.health;
  return ok({ ingested, health, newActions });
}

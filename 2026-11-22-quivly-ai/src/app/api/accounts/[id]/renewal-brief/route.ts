import { fail, ok } from "@/lib/api";
import { createBrief } from "@/lib/brief";
import { readDb } from "@/lib/store";
import { analyze } from "@/lib/analyze";

export const dynamic = "force-dynamic";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!readDb().accounts.some((a) => a.id === id)) return fail("account not found", 404);
  const brief = await createBrief(id);
  await analyze(id); // a brief clears the renewal_prep trigger; refresh health snapshot
  return ok({ brief }, 201);
}

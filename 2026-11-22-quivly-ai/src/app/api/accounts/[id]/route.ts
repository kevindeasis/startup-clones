import { fail, ok } from "@/lib/api";
import { readDb } from "@/lib/store";
import { get360 } from "@/lib/view";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = get360(readDb(), id);
  return v ? ok(v) : fail("account not found", 404);
}

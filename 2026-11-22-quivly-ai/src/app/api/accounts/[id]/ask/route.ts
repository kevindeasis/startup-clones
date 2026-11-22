import { ask } from "@/lib/ask";
import { fail, ok, parseBody } from "@/lib/api";
import { buildCtx } from "@/lib/context";
import { askBody } from "@/lib/schemas";
import { readDb } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = buildCtx(readDb(), id);
  if (!ctx) return fail("account not found", 404);
  const body = await parseBody(req, askBody);
  if ("error" in body) return body.error;
  return ok(await ask(ctx, body.data.question));
}

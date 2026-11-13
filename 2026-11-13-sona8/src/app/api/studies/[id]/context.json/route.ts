import { json, notFound } from "../../../../../lib/http";
import * as repo from "../../../../../lib/repo";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const stored = repo.getSynthesis(id);
  return stored ? json(stored.synthesis) : notFound("Synthesis");
}

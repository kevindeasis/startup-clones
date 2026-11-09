import { getContract, summarize } from "@/lib/repo";
import { err } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = getContract(id);
  if (!c) return err("Contract not found", 404);
  return Response.json({
    id: c.id,
    payer: c.payer,
    name: c.name,
    created_at: c.created_at,
    terms: c.terms,
    summary: summarize(id),
  });
}

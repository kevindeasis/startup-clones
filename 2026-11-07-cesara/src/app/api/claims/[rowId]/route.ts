import { getDb } from "@/lib/db";
import { getClaim, getContract, latestAppeal } from "@/lib/repo";
import { STATUSES } from "@/lib/types";
import { err } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ rowId: string }> }) {
  const { rowId } = await params;
  const row = getClaim(rowId);
  if (!row) return err("Claim not found", 404);
  const contract = getContract(row.contract_id);
  const clause = contract?.terms.terms.find((t) => t.id === row.clause_ref) ?? null;
  return Response.json({
    ...row,
    clause,
    payer: contract?.payer,
    contract_name: contract?.name,
    letter: latestAppeal(rowId),
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ rowId: string }> }) {
  const { rowId } = await params;
  const row = getClaim(rowId);
  if (!row) return err("Claim not found", 404);
  const body = await req.json().catch(() => null);
  if (!body || !STATUSES.includes(body.status)) return err(`status must be one of ${STATUSES.join(", ")}`);
  getDb().prepare("UPDATE claims SET status = ? WHERE id = ?").run(body.status, rowId);
  return Response.json({ ...row, status: body.status });
}

import { draftAppeal } from "@/lib/llm";
import { getClaim, getContract, saveAppeal } from "@/lib/repo";
import { err } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(_req: Request, { params }: { params: Promise<{ rowId: string }> }) {
  const { rowId } = await params;
  const row = getClaim(rowId);
  if (!row) return err("Claim not found", 404);
  const contract = getContract(row.contract_id);
  if (!contract) return err("Contract not found", 404);
  try {
    const letter = await draftAppeal(row, contract.terms);
    saveAppeal(rowId, letter);
    return Response.json({ letter });
  } catch (e) {
    return err(`Appeal generation failed: ${(e as Error).message}`, 502);
  }
}

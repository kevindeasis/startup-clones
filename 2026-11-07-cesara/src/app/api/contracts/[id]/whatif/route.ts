import { getContract, listClaims } from "@/lib/repo";
import { priceClaim } from "@/lib/pricing";
import { round2 } from "@/lib/format";
import { err } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = getContract(id);
  if (!c) return err("Contract not found", 404);
  const body = await req.json().catch(() => null);
  if (!body || typeof body.term_id !== "string") return err("term_id required");
  const idx = c.terms.terms.findIndex((t) => t.id === body.term_id || t.code === body.term_id);
  if (idx < 0) return err(`Unknown term ${body.term_id}`, 404);

  const modified = structuredClone(c.terms);
  const t = modified.terms[idx];
  for (const k of ["rate", "percent", "threshold"] as const) {
    if (body[k] !== undefined && body[k] !== null && body[k] !== "") {
      const n = Number(body[k]);
      if (!Number.isFinite(n)) return err(`${k} must be a number`);
      t[k] = n;
    }
  }

  const claims = listClaims(id);
  let before = 0;
  let after = 0;
  let changed = 0;
  const changes: { claim_id: string; before: number | null; after: number | null }[] = [];
  for (const cl of claims) {
    const b = priceClaim(cl, c.terms).expected;
    const a = priceClaim(cl, modified).expected;
    before += b ?? 0;
    after += a ?? 0;
    if (b !== a) {
      changed++;
      changes.push({ claim_id: cl.claim_id, before: b, after: a });
    }
  }
  return Response.json({
    term_id: t.id,
    before_total: round2(before),
    after_total: round2(after),
    delta: round2(after - before),
    changed_claims: changed,
    changes,
  });
}

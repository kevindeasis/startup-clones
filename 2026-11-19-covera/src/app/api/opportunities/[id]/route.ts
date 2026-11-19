import { NextResponse } from "next/server";
import { notFound, parseBody } from "@/lib/http";
import { analyse } from "@/lib/opportunities";
import { patchOpportunityBodySchema } from "@/lib/schemas";
import { getOpportunity, saveOpportunity } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const opp = getOpportunity(id);
  if (!opp) return notFound("Opportunity not found");
  return NextResponse.json({ opportunity: opp });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const opp = getOpportunity(id);
  if (!opp) return notFound("Opportunity not found");
  const body = await parseBody(req, patchOpportunityBodySchema);
  if (!body.ok) return body.res;
  const { profile, selectedQuoteId } = body.data;
  if (selectedQuoteId !== undefined) {
    const q = opp.quotes.find((x) => x.id === selectedQuoteId);
    if (!q) return NextResponse.json({ error: "Quote not found on this opportunity" }, { status: 400 });
    if (q.status !== "quoted") return NextResponse.json({ error: "Only quoted quotes can be selected" }, { status: 400 });
    opp.selectedQuoteId = selectedQuoteId;
    opp.stage = "selected";
  }
  if (profile) {
    opp.profile = profile;
    const { missing, followUpEmail } = await analyse(profile);
    opp.missing = missing;
    opp.followUpEmail = followUpEmail;
    if (opp.stage === "intake" || opp.stage === "needs_info") opp.stage = missing.length ? "needs_info" : "intake";
  }
  saveOpportunity(opp);
  return NextResponse.json({ opportunity: opp });
}

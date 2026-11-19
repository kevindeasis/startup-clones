import { NextResponse } from "next/server";
import { compareOpportunity } from "@/lib/compare";
import { notFound } from "@/lib/http";
import { draftText } from "@/lib/llm";
import { getOpportunity, saveOpportunity } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const opp = getOpportunity(id);
  if (!opp) return notFound("Opportunity not found");
  const { diff, recommendedQuoteId } = compareOpportunity(opp.profile, opp.quotes);
  if (!diff.rows.length) {
    return NextResponse.json({ error: "No quoted quotes to compare. Run the quote step first." }, { status: 409 });
  }
  const ctx = { profile: opp.profile, diff, recommendedQuoteId };
  const summary = await draftText("recommendation", ctx);
  const proposalEmail = await draftText("proposal", ctx);
  opp.comparison = { summary, proposalEmail, recommendedQuoteId, diff };
  saveOpportunity(opp);
  return NextResponse.json({ summary, proposalEmail, recommendedQuoteId, diff, opportunity: opp });
}

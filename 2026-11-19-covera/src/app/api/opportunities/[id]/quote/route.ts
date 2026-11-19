import { NextResponse } from "next/server";
import { notFound } from "@/lib/http";
import { runQuotingAgent } from "@/lib/quoting";
import { getOpportunity, saveOpportunity } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const opp = getOpportunity(id);
  if (!opp) return notFound("Opportunity not found");
  if (!opp.profile.requestedLines.length) {
    return NextResponse.json({ error: "No requested lines on this opportunity" }, { status: 400 });
  }
  opp.stage = "quoting";
  saveOpportunity(opp);
  const quotes = await runQuotingAgent(opp.profile, new URL(req.url).origin);
  const fresh = getOpportunity(id) ?? opp;
  fresh.quotes = quotes;
  fresh.comparison = undefined;
  fresh.selectedQuoteId = undefined;
  if (quotes.length && quotes.every((q) => q.status === "needs_info")) fresh.stage = "needs_info";
  else if (quotes.length) fresh.stage = "quoted";
  else fresh.stage = fresh.missing.length ? "needs_info" : "intake";
  saveOpportunity(fresh);
  return NextResponse.json({ quotes, stage: fresh.stage, opportunity: fresh });
}

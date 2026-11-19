import { NextResponse } from "next/server";
import { combineText } from "@/lib/attachments";
import { parseBody } from "@/lib/http";
import { buildOpportunity } from "@/lib/opportunities";
import { createOpportunityBodySchema } from "@/lib/schemas";
import { listOpportunities, saveOpportunity } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ opportunities: listOpportunities() });
}

export async function POST(req: Request) {
  const body = await parseBody(req, createOpportunityBodySchema);
  if (!body.ok) return body.res;
  const { text, attachments = [], profile } = body.data;
  const combinedText = combineText(text, attachments);
  if (!combinedText && !profile) {
    return NextResponse.json({ error: "Provide email text, attachments or a profile" }, { status: 400 });
  }
  const opp = await buildOpportunity({ text, attachments, combinedText, profile });
  saveOpportunity(opp);
  return NextResponse.json({ opportunity: opp }, { status: 201 });
}

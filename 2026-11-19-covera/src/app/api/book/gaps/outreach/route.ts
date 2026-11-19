import { NextResponse } from "next/server";
import { book, getIndustry } from "@/lib/data";
import { notFound, parseBody } from "@/lib/http";
import { draftText } from "@/lib/llm";
import { outreachBodySchema } from "@/lib/schemas";
import { findGapsForAccount } from "@/lib/rounding";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await parseBody(req, outreachBodySchema);
  if (!body.ok) return body.res;
  const account = book.find((a) => a.id === body.data.accountId);
  if (!account) return notFound("Account not found");
  const gap = findGapsForAccount(account).find((g) => g.line === body.data.line);
  if (!gap) return NextResponse.json({ error: "No such gap for this account" }, { status: 404 });
  const email = await draftText("outreach", { account, gap, industryName: getIndustry(account.industry)?.name });
  return NextResponse.json({ gap: { ...gap, outreachEmail: email }, email });
}

import { NextResponse } from "next/server";
import { attachmentToText, combineText } from "@/lib/attachments";
import { parseBody } from "@/lib/http";
import { extractRiskProfile, isMock } from "@/lib/llm";
import { analyse } from "@/lib/opportunities";
import { extractBodySchema } from "@/lib/schemas";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await parseBody(req, extractBodySchema);
  if (!body.ok) return body.res;
  const { text, attachments = [] } = body.data;
  const texts: { filename: string; text: string }[] = [];
  for (const a of attachments) {
    try {
      texts.push({ filename: a.filename, text: await attachmentToText(a.filename, a.base64) });
    } catch (e) {
      return NextResponse.json(
        { error: `Could not read attachment ${a.filename}: ${e instanceof Error ? e.message : String(e)}` },
        { status: 422 },
      );
    }
  }
  const combined = combineText(text, texts);
  if (!combined) return NextResponse.json({ error: "Provide email text or an attachment" }, { status: 400 });
  const profile = await extractRiskProfile(combined);
  const { missing, followUpEmail } = await analyse(profile);
  return NextResponse.json({ profile, missing, followUpEmail, attachments: texts, mock: isMock() });
}

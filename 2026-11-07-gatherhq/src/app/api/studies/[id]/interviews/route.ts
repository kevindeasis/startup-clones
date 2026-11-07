import { NextResponse } from "next/server";
import { createInterview } from "@/lib/db";
import { body, studyOr404 } from "@/lib/api";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = studyOr404(id);
  if (r.res) return r.res;
  const b = await body<{ participant_name?: string }>(req);
  const iv = createInterview(id, { name: b.participant_name ?? null });
  const base = process.env.NEXT_PUBLIC_BASE_URL || new URL(req.url).origin;
  return NextResponse.json({ id: iv.id, token: iv.token, url: `${base}/interview/${iv.token}` }, { status: 201 });
}

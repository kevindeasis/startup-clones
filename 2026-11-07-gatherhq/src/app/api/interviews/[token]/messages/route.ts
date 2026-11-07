import { NextResponse } from "next/server";
import { getInterviewByToken, getMessages, getQuestions, getStudy } from "@/lib/db";
import { step } from "@/lib/interview";
import { body, err } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const iv = getInterviewByToken(token);
  if (!iv) return err("Interview not found", 404);
  const study = getStudy(iv.study_id)!;
  return NextResponse.json({
    study: { title: study.title }, status: iv.status, total_questions: getQuestions(iv.study_id).length,
    messages: getMessages(iv.id).map((m) => ({ role: m.role, content: m.content })),
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const iv = getInterviewByToken(token);
  if (!iv) return err("Interview not found", 404);
  const b = await body<{ content?: string }>(req);
  const r = await step(iv, typeof b.content === "string" ? b.content : "");
  return NextResponse.json({ message: r.message, done: r.done });
}

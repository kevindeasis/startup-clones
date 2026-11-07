import { NextResponse } from "next/server";
import { getInterviews, getMessages, getQuestions, latestModel } from "@/lib/db";
import { studyOr404 } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = studyOr404(id);
  if (r.res) return r.res;
  const interviews = getInterviews(id).map((iv) => ({ ...iv, message_count: getMessages(iv.id).length }));
  return NextResponse.json({ study: r.study, questions: getQuestions(id), interviews, model: latestModel(id) });
}

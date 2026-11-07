import { NextResponse } from "next/server";
import { getInterviews, getMessages, latestModel, saveModel } from "@/lib/db";
import { synthesize } from "@/lib/llm";
import { err, studyOr404 } from "@/lib/api";

export const maxDuration = 300;

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = studyOr404(id);
  if (r.res) return r.res;
  const interviews = getInterviews(id)
    .filter((i) => i.status === "complete")
    .map((i) => ({ id: i.id, participant: i.participant_name || "Participant", turns: getMessages(i.id).map((m) => ({ role: m.role, content: m.content })) }));
  if (!interviews.length) return err("No completed interviews to synthesize yet", 409);
  const model = await synthesize({ title: r.study.title, goal: r.study.goal, interviews });
  saveModel(id, model);
  return NextResponse.json(latestModel(id), { status: 201 });
}

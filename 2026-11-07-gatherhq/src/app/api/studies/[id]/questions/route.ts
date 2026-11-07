import { NextResponse } from "next/server";
import { z } from "zod";
import { getQuestions, replaceQuestions } from "@/lib/db";
import { err, studyOr404 } from "@/lib/api";

const schema = z.object({ questions: z.array(z.string()).min(1).max(12) });

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = studyOr404(id);
  if (r.res) return r.res;
  const p = schema.safeParse(await req.json().catch(() => ({})));
  if (!p.success) return err("questions: string[] (1-12) required");
  const texts = p.data.questions.map((q) => q.trim()).filter(Boolean);
  if (!texts.length) return err("at least one non-empty question required");
  replaceQuestions(id, texts);
  return NextResponse.json({ questions: getQuestions(id) });
}

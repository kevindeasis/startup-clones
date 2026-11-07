import { NextResponse } from "next/server";
import { answerFromChunks } from "@/lib/llm";
import { retrieve } from "@/lib/retrieval";
import { body, err, studyOr404 } from "@/lib/api";

export const maxDuration = 120;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = studyOr404(id);
  if (r.res) return r.res;
  const b = await body<{ question?: string }>(req);
  const question = (b.question ?? "").trim();
  if (!question) return err("question required");
  const chunks = retrieve(id, question, 8);
  const answer = await answerFromChunks(question, chunks);
  const cited = new Set([...answer.matchAll(/\[int:([A-Za-z0-9_-]+)\]/g)].map((m) => m[1]));
  const citations = chunks
    .filter((c) => cited.has(c.interview_id))
    .map((c) => ({ interview_id: c.interview_id, participant: c.participant, excerpt: c.text }));
  return NextResponse.json({ answer, citations, retrieved: chunks.length });
}

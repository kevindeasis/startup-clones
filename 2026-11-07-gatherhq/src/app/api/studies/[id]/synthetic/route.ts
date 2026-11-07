import { NextResponse } from "next/server";
import { createInterview, getInterviewByToken, getMessages, getQuestions } from "@/lib/db";
import { forceClose, step } from "@/lib/interview";
import { generatePersonas, personaAnswer, type Turn } from "@/lib/llm";
import { body, studyOr404 } from "@/lib/api";

export const maxDuration = 300;
const MAX_TURNS = 10;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = studyOr404(id);
  if (r.res) return r.res;
  const b = await body<{ n?: number }>(req);
  const n = Math.max(1, Math.min(8, Math.floor(Number(b.n ?? 3)) || 3));
  const personas = await generatePersonas(r.study.goal, r.study.audience, n);
  const out = [];
  for (const p of personas) {
    const iv0 = createInterview(id, { name: p.name, persona: p, synthetic: true });
    let iv = getInterviewByToken(iv0.token)!;
    let res = await step(iv, "");
    let turns = 0;
    while (!res.done && turns < MAX_TURNS) {
      const transcript: Turn[] = getMessages(iv.id).map((m) => ({ role: m.role, content: m.content }));
      const question = res.message ?? getQuestions(id)[0].text;
      const answer = await personaAnswer(p, question, transcript);
      res = await step(iv, answer);
      turns++;
    }
    iv = getInterviewByToken(iv0.token)!;
    if (iv.status !== "complete") forceClose(iv);
    out.push({ id: iv0.id, token: iv0.token, participant: p.name, messages: getMessages(iv0.id).length });
  }
  return NextResponse.json({ created: out }, { status: 201 });
}

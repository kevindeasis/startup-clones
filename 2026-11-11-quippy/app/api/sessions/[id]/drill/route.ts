import { NextResponse } from "next/server";
import { z } from "zod";
import { mutate, readDb } from "@/lib/db";
import { gradeDrill } from "@/lib/llm";
import { MAX_DRILL_ATTEMPTS, type Drill } from "@/lib/schemas";

export const dynamic = "force-dynamic";

const Body = z.object({ lineIndex: z.number().int(), attempt: z.string().max(2000).optional(), giveUp: z.boolean().optional() });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success || (!body.data.giveUp && !body.data.attempt?.trim())) {
    return NextResponse.json({ error: "lineIndex and attempt required" }, { status: 400 });
  }
  const { lineIndex, giveUp } = body.data;
  const attempt = body.data.attempt?.trim() ?? "";
  const db = await readDb();
  const session = db.sessions.find((s) => s.id === id);
  if (!session?.feedback) return NextResponse.json({ error: "Session has no feedback yet" }, { status: 404 });
  const line = session.messages.find((m) => m.index === lineIndex && m.role === "user");
  if (!line) return NextResponse.json({ error: "Not a user line" }, { status: 400 });
  const existing = db.drills.find((d) => d.sessionId === id && d.lineIndex === lineIndex);
  if (existing?.done) return NextResponse.json({ error: "Drill already finished", drill: existing }, { status: 409 });
  if ((existing?.attempts.length ?? 0) >= MAX_DRILL_ATTEMPTS) return NextResponse.json({ error: "No attempts left" }, { status: 409 });

  const upsert = (fn: (d: Drill) => void) =>
    mutate((d) => {
      let drill = d.drills.find((x) => x.sessionId === id && x.lineIndex === lineIndex);
      if (!drill) {
        drill = { id: crypto.randomUUID(), sessionId: id, lineIndex, attempts: [], done: false };
        d.drills.push(drill);
      }
      fn(drill);
      return structuredClone(drill);
    });

  if (giveUp) {
    const drill = await upsert((d) => { d.done = true; });
    return NextResponse.json({ drill, result: null });
  }

  const scenario = db.scenarios.find((s) => s.id === session.scenarioId)!;
  const partnerLine = [...session.messages].reverse().find((m) => m.role === "partner" && m.index < lineIndex)?.text ?? "";
  const reason = session.feedback.lines.find((l) => l.index === lineIndex)?.reason ?? "";
  const { result } = await gradeDrill({ scenario, partnerLine, weakLine: line.text, reason, attempt });
  const drill = await upsert((d) => {
    d.attempts.push({ text: attempt, verdict: result.verdict, note: result.note, modelAnswer: result.model_answer });
    if (result.verdict === "landed" || d.attempts.length >= MAX_DRILL_ATTEMPTS) d.done = true;
  });
  return NextResponse.json({
    drill,
    result: { verdict: result.verdict, note: result.note, modelAnswer: result.model_answer },
    attemptsLeft: MAX_DRILL_ATTEMPTS - drill.attempts.length,
  });
}

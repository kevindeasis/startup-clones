import { NextResponse } from "next/server";
import { mutate, readDb } from "@/lib/db";
import { generateFeedback } from "@/lib/llm";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = await readDb();
  const session = db.sessions.find((s) => s.id === id);
  if (!session) return NextResponse.json({ error: "Unknown session" }, { status: 404 });
  if (session.feedback) return NextResponse.json(session.feedback);
  if (!session.messages.some((m) => m.role === "user")) {
    return NextResponse.json({ error: "Send at least one line first" }, { status: 400 });
  }
  const scenario = db.scenarios.find((s) => s.id === session.scenarioId)!;
  const { feedback, mock } = await generateFeedback({ scenario, messages: session.messages });
  await mutate((d) => {
    const s = d.sessions.find((x) => x.id === id)!;
    s.feedback = feedback;
    s.endedAt = new Date().toISOString();
    s.mock = mock;
  });
  return NextResponse.json(feedback);
}

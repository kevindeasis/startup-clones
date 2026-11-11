import { NextResponse } from "next/server";
import { mutate, readDb } from "@/lib/db";
import { streamPartnerReply } from "@/lib/llm";
import { MAX_USER_LINES, OPENING_SENTINEL } from "@/lib/schemas";

export const dynamic = "force-dynamic";

interface InPart { type: string; text?: string }
interface InMessage { role: string; parts?: InPart[]; content?: string }

function lastUserText(messages: InMessage[]): string | null {
  const last = [...messages].reverse().find((m) => m.role === "user");
  if (!last) return null;
  const text = last.parts ? last.parts.filter((p) => p.type === "text").map((p) => p.text ?? "").join("") : (last.content ?? "");
  return text.trim() || null;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const sessionId: string | undefined = body?.sessionId;
  const text = Array.isArray(body?.messages) ? lastUserText(body.messages) : null;
  if (!sessionId || !text) return NextResponse.json({ error: "sessionId and a user message are required" }, { status: 400 });
  if (text.length > 2000) return NextResponse.json({ error: "Message too long" }, { status: 400 });

  const isOpening = text === OPENING_SENTINEL;
  const state = await mutate((db) => {
    const session = db.sessions.find((s) => s.id === sessionId);
    if (!session) return { status: 404, error: "Unknown session" } as const;
    if (session.feedback || session.endedAt) return { status: 409, error: "Session already ended" } as const;
    const userCount = session.messages.filter((m) => m.role === "user").length;
    if (isOpening) {
      if (session.messages.length > 0) return { status: 409, error: "Scene already started" } as const;
    } else {
      if (session.messages.length === 0) return { status: 409, error: "Scene has not started" } as const;
      if (userCount >= MAX_USER_LINES) return { status: 409, error: "Maximum lines reached" } as const;
      session.messages.push({ role: "user", text, index: session.messages.length });
    }
    return { status: 200, history: structuredClone(session.messages), focus: session.focus } as const;
  });
  if (state.status !== 200) return NextResponse.json({ error: state.error }, { status: state.status });

  const db = await readDb();
  const scenario = db.scenarios.find((s) => s.id === db.sessions.find((x) => x.id === sessionId)!.scenarioId)!;
  return streamPartnerReply({
    scenario,
    focus: state.focus,
    history: state.history,
    onFinish: async (partnerText) => {
      await mutate((d) => {
        const s = d.sessions.find((x) => x.id === sessionId);
        if (s) s.messages.push({ role: "partner", text: partnerText.trim(), index: s.messages.length });
      });
    },
  });
}

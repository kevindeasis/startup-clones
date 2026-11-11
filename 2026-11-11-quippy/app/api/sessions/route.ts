import { NextResponse } from "next/server";
import { z } from "zod";
import { mutate } from "@/lib/db";
import { isMock } from "@/lib/llm";
import { progressFrom } from "@/lib/progress";
import type { Session } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = z.object({ scenarioId: z.string() }).safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "scenarioId required" }, { status: 400 });
  const result = await mutate((db) => {
    const scenario = db.scenarios.find((s) => s.id === body.data.scenarioId);
    if (!scenario) return { status: 404 as const, error: "Unknown scenario" };
    const p = progressFrom(db);
    if (p.states[scenario.id] === "locked") return { status: 403 as const, error: "Scenario is locked" };
    const session: Session = {
      id: crypto.randomUUID(),
      scenarioId: scenario.id,
      startedAt: new Date().toISOString(),
      messages: [],
      mock: isMock(),
      ...(p.focusScenarioId === scenario.id && p.focusPattern ? { focus: p.focusPattern } : {}),
    };
    db.sessions.push(session);
    return { status: 200 as const, session };
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ id: result.session.id, scenarioId: result.session.scenarioId, focus: result.session.focus ?? null });
}

import { NextResponse } from "next/server";
import { getProgress } from "@/lib/progress";

export const dynamic = "force-dynamic";

export async function GET() {
  const { progress, states, focusScenarioId, focusPattern } = await getProgress();
  return NextResponse.json({ ...progress, scenarioStates: states, focusScenarioId, focusPattern });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { mutate } from "@/lib/db";
import { generateCustomScenario } from "@/lib/llm";
import { CUSTOM_UNIT_ID } from "@/lib/logic";
import type { Scenario } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = z.object({ description: z.string().trim().min(5).max(500) }).safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Describe the situation in 5-500 characters" }, { status: 400 });
  const { draft } = await generateCustomScenario(body.data.description);
  const scenario = await mutate((db) => {
    if (!db.units.some((u) => u.id === CUSTOM_UNIT_ID)) {
      db.units.push({ id: CUSTOM_UNIT_ID, order: 99, title: "Custom", blurb: "Scenarios you described yourself." });
    }
    const s: Scenario = {
      ...draft,
      id: "custom-" + crypto.randomUUID().slice(0, 8),
      unitId: CUSTOM_UNIT_ID,
      order: db.scenarios.filter((x) => x.unitId === CUSTOM_UNIT_ID).length + 1,
      type: "Custom",
      custom: true,
    };
    db.scenarios.push(s);
    return s;
  });
  return NextResponse.json(scenario);
}

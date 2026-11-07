import { NextResponse } from "next/server";
import { latestModel } from "@/lib/db";
import { simulate } from "@/lib/llm";
import { SIM_DISCLAIMER } from "@/lib/prompts";
import { body, err, studyOr404 } from "@/lib/api";

export const maxDuration = 120;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = studyOr404(id);
  if (r.res) return r.res;
  const b = await body<{ stimulus?: string }>(req);
  const stimulus = (b.stimulus ?? "").trim();
  if (!stimulus) return err("stimulus required");
  const m = latestModel(id);
  if (!m) return err("Synthesize a buyer model first", 409);
  const reactions = await simulate(m.model, stimulus);
  return NextResponse.json({ disclaimer: SIM_DISCLAIMER, stimulus, reactions });
}

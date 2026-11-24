import { NextResponse } from "next/server";
import { isMock, MODEL } from "@/lib/llm";
export const dynamic = "force-dynamic";
export function GET() {
  return NextResponse.json({ ok: true, mock: isMock(), model: MODEL });
}

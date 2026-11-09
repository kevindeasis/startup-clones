import { NextResponse } from "next/server";
import { loadSamples } from "@/lib/brain/ingest";

export const dynamic = "force-dynamic";

export async function POST() {
  const added = loadSamples();
  return NextResponse.json({ added: added.length, ids: added.map((s) => s.id) }, { status: 201 });
}

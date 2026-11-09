import { NextResponse } from "next/server";
import { suggest } from "@/lib/brain/suggest";
import { listTasks } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const added = await suggest();
    return NextResponse.json({ added, tasks: listTasks() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

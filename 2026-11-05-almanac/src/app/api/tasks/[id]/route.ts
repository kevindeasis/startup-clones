import { NextResponse } from "next/server";
import { z } from "zod";
import { listTasks, saveTasks } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = z.object({ status: z.enum(["open", "done", "dismissed"]) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "status required" }, { status: 400 });
  const tasks = listTasks();
  const t = tasks.find((x) => x.id === id);
  if (!t) return NextResponse.json({ error: "not found" }, { status: 404 });
  t.status = parsed.data.status;
  saveTasks(tasks);
  return NextResponse.json(t);
}

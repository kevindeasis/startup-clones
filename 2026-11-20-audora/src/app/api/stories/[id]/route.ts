import { NextResponse } from "next/server";
import { deleteStory, getStory } from "@/lib/store";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const story = getStory(id);
  if (!story) return NextResponse.json({ error: "Story not found" }, { status: 404 });
  const { text: _omit, ...view } = story;
  void _omit;
  return NextResponse.json(view);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!deleteStory(id)) return NextResponse.json({ error: "Story not found" }, { status: 404 });
  return NextResponse.json({ deleted: true });
}

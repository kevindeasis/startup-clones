import { NextResponse } from "next/server";
import { fileSlug, toExportJson, toScreenplay } from "@/lib/export";
import { getStory } from "@/lib/store";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const story = getStory(id);
  if (!story) return NextResponse.json({ error: "Story not found" }, { status: 404 });
  const format = new URL(req.url).searchParams.get("format") ?? "json";
  const slug = fileSlug(story.title);
  if (format === "txt") {
    return new Response(toScreenplay(story), {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": `attachment; filename="${slug}.txt"`,
      },
    });
  }
  if (format === "json") {
    return new Response(JSON.stringify(toExportJson(story), null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${slug}.json"`,
      },
    });
  }
  return NextResponse.json({ error: "format must be json or txt" }, { status: 400 });
}

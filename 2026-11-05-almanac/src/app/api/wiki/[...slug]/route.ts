import { NextResponse } from "next/server";
import { z } from "zod";
import { readPage, writePage } from "@/lib/store";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ slug: string[] }> };

export async function GET(_: Request, { params }: Ctx) {
  const { slug } = await params;
  try {
    const page = readPage(slug.join("/"));
    return page ? NextResponse.json(page) : NextResponse.json({ error: "not found" }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "invalid path" }, { status: 400 });
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  const { slug } = await params;
  const parsed = z.object({ body: z.string() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "body required" }, { status: 400 });
  try {
    const page = readPage(slug.join("/"));
    if (!page) return NextResponse.json({ error: "not found" }, { status: 404 });
    const norm = (s: string) => s.trim();
    const oldLines = new Set(page.body.split("\n").map(norm));
    const newLines = parsed.data.body.split("\n").map(norm);
    const isProse = (l: string) => l && !l.startsWith("#") && !/^\|?\s*-+/.test(l) && !/^\| Date/.test(l);
    // lines the human added or changed, plus earlier human lines that are still present
    const added = newLines.filter((l) => isProse(l) && !oldLines.has(l));
    const kept = (page.human_blocks ?? []).filter((l) => newLines.includes(norm(l)));
    const human_blocks = [...new Set([...kept, ...added])];
    const saved = { ...page, body: parsed.data.body, updated: new Date().toISOString(), human_edited: true as const, human_blocks };
    writePage(saved);
    return NextResponse.json(readPage(page.path));
  } catch {
    return NextResponse.json({ error: "invalid path" }, { status: 400 });
  }
}

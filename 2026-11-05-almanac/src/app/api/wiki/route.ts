import { NextResponse } from "next/server";
import { listPages } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const pages = listPages().map(({ body, ...p }) => p);
  const tree: Record<string, typeof pages> = {};
  for (const p of pages) {
    const dir = p.path.includes("/") ? p.path.split("/")[0] : "";
    (tree[dir] ??= []).push(p);
  }
  return NextResponse.json({ pages, tree });
}

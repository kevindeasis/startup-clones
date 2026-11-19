import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!/^[\w-]+$/.test(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });
  const file = path.join(process.cwd(), "src", "data", "sample-emails", `${id}.txt`);
  try {
    return NextResponse.json({ id, text: fs.readFileSync(file, "utf8") });
  } catch {
    return NextResponse.json({ error: "Sample not found" }, { status: 404 });
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { readSite } from "@/lib/store";
import { chatEdit } from "@/lib/ops";
import { err, msg, parse } from "@/lib/http";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const p = await parse(req, z.object({ message: z.string().min(1).max(2000) }));
  if ("res" in p) return p.res;
  const site = await readSite((await params).id);
  if (!site) return err("Site not found", 404);
  try {
    return NextResponse.json(await chatEdit(site, p.data.message));
  } catch (e) {
    return err(msg(e));
  }
}

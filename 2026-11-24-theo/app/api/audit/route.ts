import { NextResponse } from "next/server";
import { z } from "zod";
import { runAudit } from "@/lib/audit";
import { err, msg, parse } from "@/lib/http";

const Body = z.object({ url: z.string().max(2000).optional(), html: z.string().max(3_000_000).optional() }).refine((b) => b.url || b.html, "url or html required");

export async function POST(req: Request) {
  const p = await parse(req, Body);
  if ("res" in p) return p.res;
  try {
    return NextResponse.json(await runAudit(p.data));
  } catch (e) {
    return err(msg(e), 422);
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { readSite } from "@/lib/store";
import { revert } from "@/lib/ops";
import { err, parse } from "@/lib/http";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const p = await parse(req, z.object({ versionId: z.string() }));
  if ("res" in p) return p.res;
  const site = await readSite((await params).id);
  if (!site) return err("Site not found", 404);
  const out = await revert(site, p.data.versionId);
  return out ? NextResponse.json(out) : err("Version not found", 404);
}

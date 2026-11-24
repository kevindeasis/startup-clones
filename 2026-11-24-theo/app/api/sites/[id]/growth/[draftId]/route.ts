import { NextResponse } from "next/server";
import { z } from "zod";
import { readSite } from "@/lib/store";
import { draftAction } from "@/lib/ops";
import { err, parse } from "@/lib/http";

export async function POST(req: Request, { params }: { params: Promise<{ id: string; draftId: string }> }) {
  const p = await parse(req, z.object({ action: z.enum(["publish", "dismiss"]) }));
  if ("res" in p) return p.res;
  const { id, draftId } = await params;
  const site = await readSite(id);
  if (!site) return err("Site not found", 404);
  const out = await draftAction(site, draftId, p.data.action);
  return "error" in out ? err(out.error, out.status) : NextResponse.json(out);
}

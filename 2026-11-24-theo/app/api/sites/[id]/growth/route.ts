import { NextResponse } from "next/server";
import { z } from "zod";
import { readSite, writeSite } from "@/lib/store";
import { err, parse } from "@/lib/http";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const p = await parse(req, z.object({ autoPublish: z.boolean() }));
  if ("res" in p) return p.res;
  const site = await readSite((await params).id);
  if (!site) return err("Site not found", 404);
  site.growth.autoPublish = p.data.autoPublish;
  return NextResponse.json(await writeSite(site));
}

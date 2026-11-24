import { NextResponse } from "next/server";
import { z } from "zod";
import { BusinessSchema, DesignDirectionSchema } from "@/lib/schema";
import { createSite } from "@/lib/ops";
import { listSites } from "@/lib/store";
import { err, msg, parse } from "@/lib/http";
export const dynamic = "force-dynamic";

export async function GET() {
  const sites = await listSites();
  return NextResponse.json(
    sites.map((s) => ({ id: s.id, slug: s.slug, name: s.business.name, city: s.business.city, region: s.business.region, pages: s.pages.length, versions: s.versions.length, createdAt: s.createdAt, updatedAt: s.updatedAt })),
  );
}

export async function POST(req: Request) {
  const p = await parse(req, z.object({ business: BusinessSchema, direction: DesignDirectionSchema }));
  if ("res" in p) return p.res;
  try {
    return NextResponse.json(await createSite(p.data.business, p.data.direction));
  } catch (e) {
    return err(msg(e));
  }
}

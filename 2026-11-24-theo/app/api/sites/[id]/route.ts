import { NextResponse } from "next/server";
import { readSite } from "@/lib/store";
import { err } from "@/lib/http";
export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const site = await readSite((await params).id);
  return site ? NextResponse.json(site) : err("Site not found", 404);
}

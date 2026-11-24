import { NextResponse } from "next/server";
import { readSite } from "@/lib/store";
import { runGrowth } from "@/lib/ops";
import { err, msg } from "@/lib/http";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const site = await readSite((await params).id);
  if (!site) return err("Site not found", 404);
  try {
    const { run, drafts, site: s } = await runGrowth(site);
    return NextResponse.json({ run, drafts, site: s });
  } catch (e) {
    return err(msg(e));
  }
}

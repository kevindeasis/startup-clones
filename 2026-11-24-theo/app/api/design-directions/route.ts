import { NextResponse } from "next/server";
import { z } from "zod";
import { BusinessSchema } from "@/lib/schema";
import { designDirections } from "@/lib/ops";
import { err, msg, parse } from "@/lib/http";

export async function POST(req: Request) {
  const p = await parse(req, z.object({ business: BusinessSchema }));
  if ("res" in p) return p.res;
  try {
    return NextResponse.json({ directions: await designDirections(p.data.business) });
  } catch (e) {
    return err(msg(e));
  }
}

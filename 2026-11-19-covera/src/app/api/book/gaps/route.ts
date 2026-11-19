import { NextResponse } from "next/server";
import { book } from "@/lib/data";
import { findGaps } from "@/lib/rounding";

export async function POST() {
  return NextResponse.json({ gaps: findGaps(book) });
}

export async function GET() {
  return NextResponse.json({ gaps: findGaps(book) });
}

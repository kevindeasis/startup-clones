import { NextResponse } from "next/server";
import { book, industries } from "@/lib/data";

export async function GET() {
  return NextResponse.json({ accounts: book, industries: industries.map((i) => ({ id: i.id, name: i.name })) });
}

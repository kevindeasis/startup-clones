import { NextResponse } from "next/server";
import { listChats } from "@/lib/store";

export const dynamic = "force-dynamic";
export const GET = async () => NextResponse.json(listChats());

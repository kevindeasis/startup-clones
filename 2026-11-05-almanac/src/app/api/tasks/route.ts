import { NextResponse } from "next/server";
import { listTasks } from "@/lib/store";

export const dynamic = "force-dynamic";
export const GET = async () => NextResponse.json(listTasks());

import { NextResponse } from "next/server";
import { HttpError } from "./service";

export async function handle(fn: () => unknown | Promise<unknown>, status = 200) {
  try {
    return NextResponse.json(await fn(), { status });
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(e);
    return NextResponse.json({ error: (e as Error).message ?? "internal error" }, { status: 500 });
  }
}
export async function json(req: Request): Promise<Record<string, any>> {
  try { return await req.json(); } catch { return {}; }
}

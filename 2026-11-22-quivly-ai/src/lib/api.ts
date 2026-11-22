import { NextResponse } from "next/server";
import type { z } from "zod";
import { mode } from "./llm";

export function ok(data: Record<string, unknown>, status = 200) {
  return NextResponse.json({ ...data, mode: mode() }, { status });
}
export function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}
export async function parseBody<S extends z.ZodType>(req: Request, schema: S): Promise<{ data: z.infer<S> } | { error: Response }> {
  let raw: unknown;
  try { raw = await req.json(); } catch { return { error: fail("body must be JSON") }; }
  const r = schema.safeParse(raw);
  if (!r.success) return { error: fail(r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ")) };
  return { data: r.data };
}

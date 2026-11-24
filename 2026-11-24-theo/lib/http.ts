import { NextResponse } from "next/server";
import type { ZodType } from "zod";

export async function parse<T>(req: Request, schema: ZodType<T>): Promise<{ data: T } | { res: NextResponse }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { res: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }) };
  }
  const r = schema.safeParse(body);
  if (!r.success) return { res: NextResponse.json({ error: "Invalid input", issues: r.error.issues }, { status: 400 }) };
  return { data: r.data };
}
export const err = (message: string, status = 500) => NextResponse.json({ error: message }, { status });
export const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

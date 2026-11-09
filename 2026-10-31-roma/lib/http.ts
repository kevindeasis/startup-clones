import { NextResponse } from "next/server";
import { z } from "zod";

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
export const err = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

export async function body<T extends z.ZodTypeAny>(req: Request, schema: T): Promise<{ data: z.infer<T> } | { res: NextResponse }> {
  let raw: unknown;
  try { raw = await req.json(); } catch { return { res: err("Invalid JSON body") }; }
  const r = schema.safeParse(raw);
  if (!r.success) return { res: NextResponse.json({ error: "Validation failed", issues: r.error.issues }, { status: 400 }) };
  return { data: r.data };
}

import { NextResponse } from "next/server";
import type { z } from "zod";

export async function parseBody<T extends z.ZodType>(
  req: Request,
  schema: T,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; res: NextResponse }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, res: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      res: NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 400 }),
    };
  }
  return { ok: true, data: parsed.data };
}

export const notFound = (what = "Not found") => NextResponse.json({ error: what }, { status: 404 });

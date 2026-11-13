import { NextResponse } from "next/server";
import type { ZodType } from "zod";

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
export const notFound = (what: string) => json({ error: `${what} not found` }, 404);

export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<{ data: T } | { error: NextResponse }> {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  return parsed.success ? { data: parsed.data } : { error: json({ error: "Invalid body", issues: parsed.error.issues }, 400) };
}

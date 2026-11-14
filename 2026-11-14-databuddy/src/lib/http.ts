import { NextResponse } from "next/server";
import type { ZodType } from "zod";
import { getSite } from "./repo";
import type { Site } from "./types";

export type SiteCtx = { params: Promise<{ id: string }> };

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
export const fail = (error: string, status = 400) => json({ error }, status);

export async function siteFrom(ctx: SiteCtx): Promise<Site | null> {
  return getSite((await ctx.params).id) ?? null;
}

export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<{ data: T } | { error: string }> {
  let raw: unknown;
  try {
    raw = JSON.parse(await req.text());
  } catch {
    return { error: "Body must be valid JSON." };
  }
  const parsed = schema.safeParse(raw);
  return parsed.success ? { data: parsed.data } : { error: parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") };
}

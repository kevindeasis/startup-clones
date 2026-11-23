import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { HttpError } from "./pipeline";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ZodError) return fail(400, e.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
    if (e instanceof HttpError) return fail(e.status, e.message);
    if (e instanceof SyntaxError) return fail(400, "Invalid JSON body");
    console.error(e);
    return fail(500, e instanceof Error ? e.message : "Internal error");
  }
}

export async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (!text.trim()) return {};
  return JSON.parse(text);
}

export type Ctx = { params: Promise<{ id: string }> };

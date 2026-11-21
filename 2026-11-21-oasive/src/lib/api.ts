import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { HttpError } from "./service";
import { mode } from "./llm";

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
    if (e instanceof HttpError) return fail(e.status, e.message);
    if (e instanceof ZodError) return fail(400, e.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
    if (e instanceof SyntaxError) return fail(400, "Invalid JSON body");
    console.error(e);
    return fail(500, (e as Error).message || "Internal error");
  }
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

export { mode };

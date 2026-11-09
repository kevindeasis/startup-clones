import { NextResponse } from "next/server";
import { UploadError } from "./storage";
import { ZodError } from "zod";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function handleError(e: unknown) {
  if (e instanceof UploadError) return json({ error: e.message }, e.status);
  if (e instanceof ZodError) return json({ error: "Invalid input", details: e.issues }, 400);
  console.error(e);
  return json({ error: e instanceof Error ? e.message : "Internal error" }, 500);
}

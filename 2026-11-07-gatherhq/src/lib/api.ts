import { NextResponse } from "next/server";
import { getStudy } from "./db";

export const err = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

export function studyOr404(id: string) {
  const s = getStudy(id);
  return s ? { study: s } : { res: err("Study not found", 404) };
}

export async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  try { return (await req.json()) as T; } catch { return {} as T; }
}

import { NextResponse } from "next/server";
import { Space, findSpace } from "./store";

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
export const err = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

export function authed(req: Request): boolean {
  const key = process.env.PADDOCK_API_KEY || "dev-key";
  const h = req.headers.get("authorization") || "";
  return h === `Bearer ${key}`;
}

export function getSpaceOr404(id: string): Space | null { return findSpace(id); }

export async function body<T = any>(req: Request): Promise<T | null> {
  try { return (await req.json()) as T; } catch { return null; }
}

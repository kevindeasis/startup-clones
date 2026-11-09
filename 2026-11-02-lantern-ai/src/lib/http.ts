import { NextResponse } from 'next/server';
import type { z } from 'zod';

export class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
export async function parseBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let body: unknown;
  try { body = await req.json(); } catch { throw new HttpError(400, 'Invalid JSON body'); }
  const r = schema.safeParse(body);
  if (!r.success) throw new HttpError(400, r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return r.data;
}
type Handler<P> = (req: Request, ctx: { params: Promise<P> }) => Promise<Response>;
export function handler<P>(fn: Handler<P>): Handler<P> {
  return async (req, ctx) => {
    try { return await fn(req, ctx); }
    catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: e instanceof Error ? e.message : 'Internal error' }, 500);
    }
  };
}

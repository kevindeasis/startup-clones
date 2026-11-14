import { z } from "zod";
import { ask, history } from "@/lib/analyst";
import { fail, json, parseBody, siteFrom, type SiteCtx } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({ question: z.string().trim().min(3).max(500) });

export async function GET(_req: Request, ctx: SiteCtx) {
  const site = await siteFrom(ctx);
  return site ? json(history(site.id)) : fail("Site not found.", 404);
}

export async function POST(req: Request, ctx: SiteCtx) {
  const site = await siteFrom(ctx);
  if (!site) return fail("Site not found.", 404);
  const body = await parseBody(req, Body);
  if ("error" in body) return fail(body.error);
  try {
    return json(await ask(site.id, body.data.question));
  } catch (e) {
    return fail((e as Error).message, 502);
  }
}

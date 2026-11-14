import { z } from "zod";
import { fail, json, parseBody, siteFrom, type SiteCtx } from "@/lib/http";
import { createFunnel, listFunnels } from "@/lib/repo";
import { StepSchema } from "@/lib/types";

export const dynamic = "force-dynamic";

const Body = z.object({ name: z.string().trim().min(1).max(100), steps: z.array(StepSchema).min(2).max(5) });

export async function GET(_req: Request, ctx: SiteCtx) {
  const site = await siteFrom(ctx);
  return site ? json(listFunnels(site.id)) : fail("Site not found.", 404);
}

export async function POST(req: Request, ctx: SiteCtx) {
  const site = await siteFrom(ctx);
  if (!site) return fail("Site not found.", 404);
  const body = await parseBody(req, Body);
  if ("error" in body) return fail(body.error);
  return json(createFunnel(site.id, body.data.name, body.data.steps), 201);
}

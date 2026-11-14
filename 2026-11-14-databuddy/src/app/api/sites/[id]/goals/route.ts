import { z } from "zod";
import { goalResults } from "@/lib/funnels";
import { fail, json, parseBody, siteFrom, type SiteCtx } from "@/lib/http";
import { parseRange } from "@/lib/range";
import { createGoal, listGoals } from "@/lib/repo";

export const dynamic = "force-dynamic";

const Body = z.object({ name: z.string().trim().min(1).max(100), kind: z.enum(["path", "event"]), target: z.string().trim().min(1).max(300) });

export async function GET(req: Request, ctx: SiteCtx) {
  const site = await siteFrom(ctx);
  if (!site) return fail("Site not found.", 404);
  const range = parseRange(new URL(req.url).searchParams.get("range"));
  return json(goalResults(site.id, listGoals(site.id), range));
}

export async function POST(req: Request, ctx: SiteCtx) {
  const site = await siteFrom(ctx);
  if (!site) return fail("Site not found.", 404);
  const body = await parseBody(req, Body);
  if ("error" in body) return fail(body.error);
  return json(createGoal(site.id, body.data.name, body.data.kind, body.data.target), 201);
}

import { z } from "zod";
import { fail, json, parseBody } from "@/lib/http";
import { createSite, listSites } from "@/lib/repo";

export const dynamic = "force-dynamic";

const Body = z.object({ name: z.string().trim().min(1).max(100), domain: z.string().trim().min(1).max(200) });

export const GET = () => json(listSites());

export async function POST(req: Request) {
  const body = await parseBody(req, Body);
  if ("error" in body) return fail(body.error);
  return json(createSite(body.data.name, body.data.domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "")), 201);
}

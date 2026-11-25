import { z } from "zod";
import { authed, body, err, json } from "@/lib/api";
import { createSpace, currentVersion, listSpaces, summary } from "@/lib/store";
import { searchSpaces } from "@/lib/search";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q");
  if (q) return json(searchSpaces(q, true));
  return json(listSpaces().map(summary));
}

const Schema = z.object({ title: z.string().min(1), html: z.string().min(1), visibility: z.enum(["private", "public"]).optional(), slug: z.string().optional() });

export async function POST(req: Request) {
  if (!authed(req)) return err("Unauthorized", 401);
  const p = Schema.safeParse(await body(req));
  if (!p.success) return err(p.error.issues.map((i) => i.message).join("; "));
  const s = createSpace(p.data.title, p.data.html, p.data.visibility, p.data.slug);
  const host = req.headers.get("host");
  const base = process.env.PADDOCK_PUBLIC_URL || (host ? `http://${host}` : "");
  return json({ id: s.id, slug: s.slug, url: `${base}/s/${s.slug}`, version: currentVersion(s).n }, 201);
}

import { z } from "zod";
import { handle, json, mode, readJson } from "@/lib/api";
import { fetchArticle, ingestNews } from "@/lib/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const body = z.union([
  z.object({ url: z.string().min(1) }),
  z.object({
    title: z.string().trim().min(1), text: z.string().trim().min(1), source: z.string().optional(),
    publishedAt: z.string().optional(),
  }),
]);

export function POST(req: Request) {
  return handle(async () => {
    const b = body.parse(await readJson(req));
    if ("url" in b) {
      const art = await fetchArticle(b.url);
      const item = await ingestNews({ ...art, url: b.url });
      return json({ item, mode: mode() }, 201);
    }
    if (b.publishedAt && Number.isNaN(Date.parse(b.publishedAt))) return json({ error: "publishedAt is not a valid date" }, 400);
    const item = await ingestNews({ ...b, publishedAt: b.publishedAt ? new Date(b.publishedAt).toISOString() : undefined });
    return json({ item, mode: mode() }, 201);
  });
}

import { handle, json, mode } from "@/lib/api";
import { newsFeed } from "@/lib/service";

export const dynamic = "force-dynamic";
export function GET(req: Request) {
  return handle(async () => {
    const q = new URL(req.url).searchParams;
    const items = await newsFeed({
      obligorId: q.get("obligorId") || undefined, type: q.get("type") || undefined, severity: q.get("severity") || undefined,
      watchlistId: q.get("watchlistId") || undefined, includeFiltered: q.get("includeFiltered") === "true" || q.get("includeFiltered") === "1",
    });
    return json({ items, mode: mode() });
  });
}

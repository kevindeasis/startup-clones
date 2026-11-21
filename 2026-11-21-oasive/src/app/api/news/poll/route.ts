import { handle, json, mode } from "@/lib/api";
import { pollFeeds } from "@/lib/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export function POST() {
  return handle(async () => json({ ...(await pollFeeds()), mode: mode() }));
}

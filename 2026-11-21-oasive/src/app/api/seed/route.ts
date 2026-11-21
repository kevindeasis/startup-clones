import { handle, json } from "@/lib/api";
import { seedAll } from "@/lib/seed";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export function POST() {
  return handle(async () => json(await seedAll()));
}

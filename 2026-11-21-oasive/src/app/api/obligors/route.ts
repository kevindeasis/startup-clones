import { handle, json, mode } from "@/lib/api";
import { obligorSummaries } from "@/lib/service";

export const dynamic = "force-dynamic";
export function GET() {
  return handle(async () => json({ obligors: await obligorSummaries(), mode: mode() }));
}

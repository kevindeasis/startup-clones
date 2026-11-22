import { ok } from "@/lib/api";
import { readDb } from "@/lib/store";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const status = new URL(req.url).searchParams.get("status");
  const actions = readDb().actions.filter((a) => !status || a.status === status);
  return ok({ actions });
}

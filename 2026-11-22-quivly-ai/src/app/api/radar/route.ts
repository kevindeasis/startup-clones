import { ok, parseBody } from "@/lib/api";
import { ingestSignal } from "@/lib/radar";
import { radarBody } from "@/lib/schemas";
import { readDb } from "@/lib/store";

export const dynamic = "force-dynamic";

export function GET() {
  return ok({ signals: readDb().signals.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)) });
}

export async function POST(req: Request) {
  const body = await parseBody(req, radarBody);
  if ("error" in body) return body.error;
  return ok(await ingestSignal(body.data), 201);
}

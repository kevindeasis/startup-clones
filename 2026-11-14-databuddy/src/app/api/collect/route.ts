import { NextResponse } from "next/server";
import { CollectBodySchema, ingest } from "@/lib/collect";
import { fail, parseBody } from "@/lib/http";

export const dynamic = "force-dynamic";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export const OPTIONS = () => new NextResponse(null, { status: 204, headers: CORS });

export async function POST(req: Request) {
  const body = await parseBody(req, CollectBodySchema);
  if ("error" in body) return withCors(fail(body.error));
  const events = Array.isArray(body.data) ? body.data : [body.data];
  const h = req.headers;
  const n = ingest(events, {
    ip: h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || "0.0.0.0",
    userAgent: h.get("user-agent") ?? "",
    country: h.get("cf-ipcountry") || h.get("x-vercel-ip-country") || h.get("x-country") || "Unknown",
  });
  if (n === null) return withCors(fail("Unknown site.", 404));
  return withCors(NextResponse.json({ ok: true, n }, { status: 202 }));
}

function withCors(res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
  return res;
}

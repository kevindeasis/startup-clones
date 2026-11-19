import { NextResponse } from "next/server";
import { carrierBodySchema, missingRequired, quotableLines, unmapBody } from "@/lib/carriers";
import { getCarrier } from "@/lib/data";
import { appetiteDecline, rateLine } from "@/lib/rating";
import type { PortalLineResult, PortalResponse } from "@/lib/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ carrierId: string }> };

/** Mock carrier portal: validates against the carrier's own schema, applies appetite, rates deterministically. */
export async function POST(req: Request, { params }: Ctx) {
  const { carrierId } = await params;
  const carrier = getCarrier(carrierId);
  if (!carrier) return NextResponse.json({ error: `Unknown carrier ${carrierId}` }, { status: 404 });
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = carrierBodySchema(carrier).safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Schema validation failed", issues: parsed.error.issues }, { status: 400 });
  }
  const body = parsed.data as Record<string, unknown>;
  const profile = unmapBody(carrier, body);
  const lines = quotableLines(carrier, profile.requestedLines);
  const respond = (status: PortalResponse["status"], results: PortalLineResult[], missing: string[]) =>
    NextResponse.json({ carrierId, status, missing, turnaroundMs: carrier.turnaroundMs, results } satisfies PortalResponse);

  if (!lines.length) {
    return respond("declined", [], []);
  }
  const missing = missingRequired(carrier, body, lines);
  if (missing.length) {
    return respond(
      "needs_info",
      lines.map((line) => ({ line, status: "needs_info" as const, reason: `Missing required fields: ${missing.join(", ")}` })),
      missing,
    );
  }
  const decline = appetiteDecline(carrier, profile);
  if (decline) {
    return respond("declined", lines.map((line) => ({ line, status: "declined" as const, reason: decline })), []);
  }
  return respond("quoted", lines.map((line) => rateLine(carrier, line, profile)), []);
}

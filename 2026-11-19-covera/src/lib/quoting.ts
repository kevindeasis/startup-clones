import { carriers } from "./data";
import { mapProfileToCarrier, quotableLines } from "./carriers";
import { newId } from "./store";
import type { PortalResponse, Quote, RiskProfile } from "./types";

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

/** The quoting agent: for each carrier in play, map -> POST to that carrier's portal -> store quotes with step logs. */
export async function runQuotingAgent(profile: RiskProfile, origin: string): Promise<Quote[]> {
  const quotes: Quote[] = [];
  for (const carrier of carriers) {
    const lines = quotableLines(carrier, profile.requestedLines);
    if (!lines.length) continue;
    const { payload, mapped, missing } = mapProfileToCarrier(carrier, profile);
    const total = Object.keys(carrier.fieldSchema).length;
    const base: string[] = [
      `Opened ${carrier.name} portal (/portal/${carrier.id})`,
      `Mapped ${mapped.length} of ${total} fields to ${carrier.name}'s schema`,
      missing.length
        ? `Missing required fields: ${missing.join(", ")} (submitting with partial data)`
        : "All required fields present",
      `Submitted POST /api/carriers/${carrier.id}/quote for ${lines.join(", ")}`,
    ];
    let res: PortalResponse | undefined;
    let error: string | undefined;
    try {
      const r = await fetch(`${origin}/api/carriers/${carrier.id}/quote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await r.json();
      if (r.ok) res = json as PortalResponse;
      else error = `Portal rejected submission (HTTP ${r.status}): ${JSON.stringify(json.issues ?? json.error ?? json)}`;
    } catch (e) {
      error = `Portal unreachable: ${e instanceof Error ? e.message : String(e)}`;
    }
    const createdAt = new Date().toISOString();
    if (!res) {
      for (const line of lines) {
        quotes.push({
          id: newId("q"),
          carrierId: carrier.id,
          carrierName: carrier.name,
          line,
          status: "needs_info",
          reason: error,
          log: [...base, error ?? "Unknown portal error"],
          createdAt,
        });
      }
      continue;
    }
    for (const r of res.results) {
      const outcome =
        r.status === "quoted"
          ? `Quoted ${usd(r.premium ?? 0)} (deductible ${usd(r.deductible ?? 0)}) in ~${res.turnaroundMs}ms`
          : r.status === "declined"
            ? `Declined: ${r.reason}`
            : `Needs info: ${r.reason}`;
      quotes.push({
        id: newId("q"),
        carrierId: carrier.id,
        carrierName: carrier.name,
        line: r.line,
        status: r.status,
        premium: r.premium,
        deductible: r.deductible,
        limits: r.limits,
        coverages: r.coverages,
        exclusions: r.exclusions,
        reason: r.reason,
        log: [...base, `${r.line}: ${outcome}`],
        createdAt,
      });
    }
  }
  return quotes;
}

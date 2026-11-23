import { describe, expect, it } from "vitest";
import { evaluateRequirement, extractKeyFields } from "../src/lib/requirements";
import { profile } from "./fixtures";

describe("requirements rule engine", () => {
  it("marks standards the profile lists as yes", () => {
    const r = evaluateRequirement({ kind: "certification", text: "Wetted parts certified to NSF/ANSI 61.", quote: "" }, profile);
    expect(r.meetsProfile).toBe("yes");
    expect(evaluateRequirement({ kind: "certification", text: "Valves conform to AWWA C508.", quote: "" }, profile).meetsProfile).toBe("yes");
  });
  it("marks standards missing from the profile as no", () => {
    expect(evaluateRequirement({ kind: "certification", text: "Fittings per ASTM A536.", quote: "" }, profile).meetsProfile).toBe("no");
  });
  it("returns unknown when no standard is recognised", () => {
    expect(evaluateRequirement({ kind: "certification", text: "Bidder holds a valid license.", quote: "" }, profile).meetsProfile).toBe("unknown");
  });
  it("compares bond amount to bonding capacity", () => {
    const bond = { kind: "bond" as const, text: "Bid bond of 5% of the bid price.", quote: "" };
    expect(evaluateRequirement(bond, profile, { engineersEstimate: 1_850_000 }).meetsProfile).toBe("yes");
    expect(evaluateRequirement(bond, profile, { engineersEstimate: 200_000_000 }).meetsProfile).toBe("no");
    expect(evaluateRequirement(bond, profile, {}).meetsProfile).toBe("unknown");
  });
  it("extracts key fields with page numbers", () => {
    const kf = extractKeyFields([
      { n: 1, text: "The engineer's estimate is $1.85M.\nSealed bids are due December 18, 2026 at 2:00 PM Pacific. A pre-bid meeting will be held December 2, 2026. Written questions are due December 9, 2026." },
      { n: 3, text: "Each bid shall be accompanied by a bid bond of 5% of the total bid price." },
    ]);
    expect(kf.bidDue?.iso).toBe("2026-12-18");
    expect(kf.bidDue?.page).toBe(1);
    expect(kf.preBid?.iso).toBe("2026-12-02");
    expect(kf.questionsDeadline?.iso).toBe("2026-12-09");
    expect(kf.bidBond).toMatchObject({ value: "5%", page: 3 });
    expect(kf.engineersEstimate?.amount).toBe(1_850_000);
  });
});

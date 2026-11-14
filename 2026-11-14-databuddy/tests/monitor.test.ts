import { describe, expect, it } from "vitest";
import { detectChanges, isMeaningful, type Metrics } from "../src/lib/monitor";
import { templateDigest } from "../src/lib/digest";

const base: Metrics = { visitors: 100, pageviews: 300, sessions: 120, bounceRate: 0.5, errors: 10, goals: { Signups: 20 }, pages: { "/pricing": 40, "/": 100 }, referrers: { "google.com": 50 } };

describe("monitor thresholds", () => {
  it("requires both 20% change and a base of at least 20", () => {
    expect(isMeaningful(24, 20)).toBe(true);
    expect(isMeaningful(23, 20)).toBe(false);
    expect(isMeaningful(15, 10)).toBe(false);
    expect(isMeaningful(40, 100)).toBe(true);
    expect(isMeaningful(70, 100)).toBe(true);
    expect(isMeaningful(110, 100)).toBe(false);
  });

  it("honours configurable thresholds", () => {
    expect(isMeaningful(11, 10, { minPct: 10, minBase: 5 })).toBe(true);
  });

  it("detects the biggest movers and sorts by relative change", () => {
    const cur: Metrics = { ...base, pages: { "/pricing": 80, "/": 102 }, referrers: { "google.com": 51, "producthunt.com": 60 } };
    const prev: Metrics = { ...base, referrers: { "google.com": 50, "producthunt.com": 40 } };
    const changes = detectChanges(cur, prev);
    expect(changes.map((c) => c.label)).toEqual(["/pricing", "producthunt.com"]);
    expect(changes[0]).toMatchObject({ kind: "page", delta: 40, deltaPct: 100 });
  });

  it("returns nothing for a flat week and a friendly digest", () => {
    expect(detectChanges(base, base)).toEqual([]);
    expect(templateDigest("Site", [])).toContain("quiet week");
  });

  it("template digest has headline, bullets and next steps", () => {
    const changes = detectChanges({ ...base, pages: { "/pricing": 80, "/": 100 } }, base);
    const md = templateDigest("Site", changes);
    expect(md).toMatch(/^## Site: \/pricing up 100%/);
    expect(md).toContain("### Suggested next steps");
  });
});

import { describe, expect, it } from "vitest";
import { computeFunnelCounts, type FunnelEvent } from "../src/lib/funnels";

const pv = (session_id: string, path: string): FunnelEvent => ({ session_id, type: "pageview", path, name: null });
const ev = (session_id: string, name: string): FunnelEvent => ({ session_id, type: "event", path: "/", name });
const steps = [
  { kind: "path" as const, value: "/" },
  { kind: "path" as const, value: "/pricing" },
  { kind: "event" as const, value: "signup" },
];

describe("computeFunnelCounts", () => {
  it("counts ordered steps per session", () => {
    const events = [
      pv("a", "/"), pv("a", "/pricing"), ev("a", "signup"),
      pv("b", "/"), pv("b", "/pricing"),
      pv("c", "/"),
    ];
    expect(computeFunnelCounts(steps, events)).toEqual([3, 2, 1]);
  });

  it("does not count step 2 that happens before step 1", () => {
    const events = [pv("a", "/pricing"), pv("a", "/"), pv("b", "/"), pv("b", "/pricing")];
    expect(computeFunnelCounts(steps, events)).toEqual([2, 1, 0]);
  });

  it("does not count a signup without the previous step in the same session", () => {
    expect(computeFunnelCounts(steps, [pv("a", "/"), ev("b", "signup")])).toEqual([1, 0, 0]);
  });
});

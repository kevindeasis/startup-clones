import { describe, expect, it } from "vitest";
import { pickSession, visitorId } from "../src/lib/visitor";

describe("sessions", () => {
  const visitor = "abcdef0123456789";
  const t0 = Date.parse("2026-11-14T10:00:00Z");

  it("reuses the session when the last event is 10 minutes old", () => {
    const first = pickSession(visitor, undefined, t0);
    const second = pickSession(visitor, { session_id: first, ts: new Date(t0).toISOString() }, t0 + 10 * 60_000);
    expect(second).toBe(first);
  });

  it("starts a new session after 40 minutes", () => {
    const first = pickSession(visitor, undefined, t0);
    const second = pickSession(visitor, { session_id: first, ts: new Date(t0).toISOString() }, t0 + 40 * 60_000);
    expect(second).not.toBe(first);
    expect(second.startsWith(visitor)).toBe(true);
  });

  it("visitor ids are stable within a day, rotate across days and across sites", () => {
    const a = visitorId("s1", "1.1.1.1", "UA", new Date("2026-11-14T01:00:00Z"), "secret");
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(visitorId("s1", "1.1.1.1", "UA", new Date("2026-11-14T23:00:00Z"), "secret")).toBe(a);
    expect(visitorId("s1", "1.1.1.1", "UA", new Date("2026-11-15T01:00:00Z"), "secret")).not.toBe(a);
    expect(visitorId("s2", "1.1.1.1", "UA", new Date("2026-11-14T01:00:00Z"), "secret")).not.toBe(a);
  });
});

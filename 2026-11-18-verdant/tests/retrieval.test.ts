import { describe, expect, it } from "vitest";
import { scorePermitTypes, searchCode } from "@/lib/retrieval";

describe("retrieval", () => {
  it("returns the fence section first for 'backyard fence height'", () => {
    const r = searchCode("backyard fence height");
    expect(r[0].id).toBe("17.24.010");
  });
  it("finds ADU setbacks", () => {
    expect(searchCode("ADU setback").slice(0, 2).map((s) => s.id)).toContain("17.20.030");
  });
  it("scores permit types by triggers", () => {
    expect(scorePermitTypes("I want to build a 6 foot fence")[0].permit.id).toBe("fence");
    expect(scorePermitTypes("hello")).toHaveLength(0);
  });
});

import { describe, expect, it } from "vitest";
import samples from "@/data/sample-applications.json";
import { getPermitType } from "@/lib/permits";
import { evaluateRule, runRules } from "@/lib/rules";
import type { Application, Attachment } from "@/lib/types";

const adu = getPermitType("adu")!;
const docs = (...kinds: Attachment["kind"][]): Attachment[] =>
  kinds.map((k, i) => ({ id: String(i), filename: `${k}.txt`, kind: k, text: "x" }));
const good = { floorAreaSqFt: 600, lotAreaSqFt: 7200, sideSetbackFt: 5, rearSetbackFt: 6, heightFt: 14 };

describe("rule engine", () => {
  it("fails a 3 ft ADU side setback with citation", () => {
    const checks = runRules(adu, { ...good, sideSetbackFt: 3 }, docs("site_plan", "floor_plan", "elevations"));
    const c = checks.find((x) => x.id === "adu-side")!;
    expect(c.status).toBe("fail");
    expect(c.citation).toBe("17.20.030");
  });
  it("needs_info on missing site plan", () => {
    const checks = runRules(adu, good, docs("floor_plan", "elevations"));
    expect(checks.find((x) => x.id === "adu-site-plan")!.status).toBe("needs_info");
  });
  it("passes when everything is fine", () => {
    const checks = runRules(adu, good, docs("site_plan", "floor_plan", "elevations"));
    expect(checks.every((c) => c.status === "pass")).toBe(true);
  });
  it("needs_info on missing numeric field", () => {
    const checks = runRules(adu, { ...good, sideSetbackFt: "" }, docs("site_plan", "floor_plan", "elevations"));
    expect(checks.find((x) => x.id === "adu-side")!.status).toBe("needs_info");
  });
  it("ratio_max evaluates coverage", () => {
    const rule = adu.rules.find((r) => r.kind === "ratio_max")!;
    expect(evaluateRule(rule, { floorAreaSqFt: 900, lotAreaSqFt: 2000 }, []).status).toBe("fail");
    expect(evaluateRule(rule, { floorAreaSqFt: 600, lotAreaSqFt: 7200 }, []).status).toBe("pass");
    expect(evaluateRule(rule, { floorAreaSqFt: 600 }, []).status).toBe("needs_info");
  });
  it("sample ADU application yields fail + needs_info", () => {
    const app = (samples as unknown as Application[]).find((a) => a.permitType === "adu")!;
    const checks = runRules(adu, app.fields, app.attachments);
    expect(checks.some((c) => c.status === "fail")).toBe(true);
    expect(checks.some((c) => c.status === "needs_info")).toBe(true);
  });
});

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { attachmentToText } from "./attachments";
import { carrierBodySchema, mapProfileToCarrier, missingRequired, unmapBody } from "./carriers";
import { buildDiff } from "./compare";
import { book, getCarrier } from "./data";
import { mockExtractRiskProfile } from "./mock-extract";
import { mockDraft } from "./mock-drafts";
import { appetiteDecline, ratePremium } from "./rating";
import { computeMissing, uniqueMissingFields } from "./requirements";
import { findGaps, findGapsForAccount } from "./rounding";
import type { Quote, RiskProfile } from "./types";

const sample = (n: string) =>
  fs.readFileSync(path.join(process.cwd(), "src/data/sample-emails", n), "utf8");

describe("mock extractor on sample emails", () => {
  it("restaurant", () => {
    const p = mockExtractRiskProfile(sample("01-restaurant.txt"));
    expect(p.businessName).toBe("Marigold Kitchen & Bar");
    expect(p.industry).toBe("restaurant");
    expect(p.requestedLines).toEqual(["bop", "liquor"]);
    expect(p.address).toEqual({ street: "418 Congress Ave", city: "Austin", state: "TX", zip: "78701" });
    expect(p.annualRevenue).toBe(1_800_000);
    expect(p.annualPayroll).toBe(520_000);
    expect(p.employees).toBe(14);
    expect(p.yearsInBusiness).toBe(6);
    expect(p.building).toMatchObject({ squareFeet: 3200, yearBuilt: 2004, sprinklered: true, owned: false });
    expect(p.priorClaims?.count).toBe(0);
    expect(p.effectiveDate).toBe("2027-01-15");
    expect(p.contactName).toBe("Dana Whitfield");
    expect(p.contactEmail).toBe("dana@marigoldkitchen.example");
    expect(p.notes).toMatch(/35%/);
  });
  it("landscaper", () => {
    const p = mockExtractRiskProfile(sample("02-landscaper.txt"));
    expect(p.businessName).toBe("Evergreen Lawn & Landscape Co");
    expect(p.industry).toBe("landscaping");
    expect(p.requestedLines).toEqual(["gl", "wc", "auto"]);
    expect(p.annualRevenue).toBe(2_100_000);
    expect(p.annualPayroll).toBe(640_000);
    expect(p.employees).toBe(18);
    expect(p.vehicles).toBe(6);
    expect(p.priorClaims?.count).toBe(1);
    expect(p.effectiveDate).toBe("2027-03-01");
    expect(p.address?.state).toBe("NC");
  });
  it("e-commerce is missing revenue", () => {
    const p = mockExtractRiskProfile(sample("03-ecommerce.txt"));
    expect(p.industry).toBe("e-commerce");
    expect(p.requestedLines).toEqual(["bop", "cyber"]);
    expect(p.annualRevenue).toBeUndefined();
    expect(p.employees).toBe(5);
    expect(p.address?.state).toBe("ME");
    expect(computeMissing(p).map((m) => m.field)).toContain("annualRevenue");
  });
  it("contractor renewal with prior claim", () => {
    const p = mockExtractRiskProfile(sample("04-contractor-renewal.txt"));
    expect(p.businessName).toBe("Ridgeline Builders LLC");
    expect(p.industry).toBe("contractor");
    expect(p.requestedLines).toEqual(["gl", "wc"]);
    expect(p.priorClaims?.count).toBe(1);
    expect(p.annualRevenue).toBe(3_400_000);
    expect(p.building?.owned).toBe(true);
    expect(p.effectiveDate).toBe("2027-02-01");
  });
  it("is deterministic", () => {
    const t = sample("01-restaurant.txt");
    expect(JSON.stringify(mockExtractRiskProfile(t))).toBe(JSON.stringify(mockExtractRiskProfile(t)));
  });
});

describe("requirements engine", () => {
  it("requires general + per-line fields", () => {
    const m = computeMissing({ requestedLines: ["wc", "auto"] });
    const fields = m.map((x) => `${x.line}:${x.field}`);
    expect(fields).toEqual(
      expect.arrayContaining(["general:businessName", "general:address.state", "general:industry", "wc:annualPayroll", "wc:employees", "auto:vehicles"]),
    );
  });
  it("liquor needs a share mention", () => {
    const base: RiskProfile = { requestedLines: ["liquor"], businessName: "x", industry: "restaurant", address: { state: "TX" }, annualRevenue: 1 };
    expect(computeMissing(base).some((m) => m.field === "notes")).toBe(true);
    expect(computeMissing({ ...base, notes: "35% of sales from liquor" })).toEqual([]);
  });
  it("dedupes fields for follow-up", () => {
    const u = uniqueMissingFields(computeMissing({ requestedLines: ["bop", "gl", "cyber"] }));
    expect(u.filter((x) => x.field === "annualRevenue")).toHaveLength(1);
  });
  it("writes a confirmation when nothing is missing", () => {
    const profile: RiskProfile = { requestedLines: ["gl"], businessName: "Acme", contactName: "Jo Lee" };
    const email = mockDraft("followUp", { profile, missing: [] });
    expect(email).toMatch(/everything we need/);
    expect(email).toMatch(/going to market/);
    expect(email).not.toMatch(/send over the following/);
  });
  it("drafts follow-up mentioning revenue", () => {
    const profile = mockExtractRiskProfile(sample("03-ecommerce.txt"));
    const email = mockDraft("followUp", { profile, missing: uniqueMissingFields(computeMissing(profile)) });
    expect(email).toMatch(/Annual revenue/);
  });
});

describe("carrier mapping with partial data", () => {
  const cinder = getCarrier("cinder")!;
  it("records mapped and missing fields", () => {
    const profile: RiskProfile = { requestedLines: ["cyber"], businessName: "Acme", address: { state: "ME" }, industry: "e-commerce", employees: 5 };
    const { payload, mapped, missing } = mapProfileToCarrier(cinder, profile);
    expect(payload.company_name).toBe("Acme");
    expect(payload.employee_count).toBe(5);
    expect(mapped).toEqual(["company_name", "domicile_state", "industry_segment", "employee_count"]);
    expect(missing).toEqual(["gross_revenue"]);
    expect(missingRequired(cinder, payload, ["cyber"])).toEqual(["gross_revenue"]);
  });
  it("validates carrier-specific schema", () => {
    const schema = carrierBodySchema(cinder);
    expect(schema.safeParse({ lines_requested: ["cyber"], company_name: "A" }).success).toBe(true);
    expect(schema.safeParse({ lines_requested: ["cyber"], gross_revenue: "lots" }).success).toBe(false);
    expect(schema.safeParse({ lines_requested: ["cyber"], businessName: "A" }).success).toBe(false);
  });
  it("round-trips via unmapBody", () => {
    const profile = mockExtractRiskProfile(sample("02-landscaper.txt"));
    const ns = getCarrier("northstar")!;
    const back = unmapBody(ns, mapProfileToCarrier(ns, profile).payload);
    expect(back.annualRevenue).toBe(profile.annualRevenue);
    expect(back.address?.state).toBe("NC");
  });
});

describe("rating and appetite", () => {
  const profile = mockExtractRiskProfile(sample("02-landscaper.txt"));
  it("is deterministic", () => {
    const c = getCarrier("northstar")!;
    expect(ratePremium(c, "gl", profile)).toBe(ratePremium(c, "gl", { ...profile }));
    expect(ratePremium(c, "gl", profile)).toBeGreaterThan(0);
  });
  it("applies claims factor", () => {
    const c = getCarrier("northstar")!;
    const none = ratePremium(c, "gl", { ...profile, priorClaims: { count: 0 } })!;
    const two = ratePremium(c, "gl", { ...profile, priorClaims: { count: 2 } })!;
    expect(two).toBeGreaterThan(none);
  });
  it("harborline declines restaurants with liquor; ironbridge declines OH", () => {
    const rest = mockExtractRiskProfile(sample("01-restaurant.txt"));
    expect(appetiteDecline(getCarrier("harborline")!, rest)).toMatch(/liquor/);
    expect(appetiteDecline(getCarrier("northstar")!, rest)).toBeUndefined();
    expect(appetiteDecline(getCarrier("ironbridge")!, { requestedLines: ["wc"], address: { state: "OH" } })).toMatch(/OH/);
  });
});

describe("comparison diff", () => {
  const mk = (id: string, premium: number, n: number): Quote => ({
    id, carrierId: id, carrierName: id, line: "gl", status: "quoted", premium,
    coverages: Array.from({ length: n }, (_, i) => `c${i}`), log: ["x"], createdAt: "",
  });
  it("picks cheapest, broadest and recommended in code", () => {
    const d = buildDiff([mk("a", 1000, 2), mk("b", 1100, 4), mk("c", 2000, 5)]);
    const lc = d.byLine[0];
    expect(lc.cheapestQuoteId).toBe("a");
    expect(lc.broadestQuoteId).toBe("c");
    expect(lc.recommendedQuoteId).toBe("a");
    expect(buildDiff([mk("a", 1000, 2), mk("b", 1100, 4)]).byLine[0].recommendedQuoteId).toBe("b");
  });
});

describe("account rounding", () => {
  it("flags liquor, wc and cyber gaps in the seeded book", () => {
    const gaps = findGaps(book);
    expect(gaps.length).toBeGreaterThanOrEqual(3);
    expect(gaps.some((g) => g.line === "liquor")).toBe(true);
    expect(gaps.some((g) => g.line === "wc")).toBe(true);
    expect(gaps.some((g) => g.line === "cyber")).toBe(true);
  });
  it("special rules", () => {
    const base = { id: "a", name: "A", state: "TX", policies: [] as never[] };
    expect(findGapsForAccount({ ...base, industry: "restaurant", employees: 0 }).map((g) => g.line)).toContain("liquor");
    expect(findGapsForAccount({ ...base, industry: "retail", employees: 3 }).map((g) => g.line)).toContain("wc");
    expect(findGapsForAccount({ ...base, industry: "software", employees: 0 }).map((g) => g.line)).toContain("cyber");
    expect(findGapsForAccount({ ...base, industry: "retail", employees: 0, policies: [{ line: "bop", carrier: "x", premium: 1, expiration: "2027-01-01" }, { line: "wc", carrier: "x", premium: 1, expiration: "2027-01-01" }] })).toEqual([]);
  });
});

describe("attachments", () => {
  it("decodes text files and PDFs", async () => {
    expect(await attachmentToText("a.txt", Buffer.from("hello there").toString("base64"))).toBe("hello there");
    const pdf = buildPdf("Revenue is 1.2M dollars");
    const text = await attachmentToText("x.pdf", pdf.toString("base64"));
    expect(text).toContain("Revenue is 1.2M dollars");
  });
});

function buildPdf(line: string): Buffer {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${`BT /F1 12 Tf 72 700 Td (${line}) Tj ET`.length} >>\nstream\nBT /F1 12 Tf 72 700 Td (${line}) Tj ET\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

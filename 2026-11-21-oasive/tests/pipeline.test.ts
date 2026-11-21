import { describe, expect, it } from "vitest";
import { chunkPages } from "@/lib/chunker";
import { verifyCitation } from "@/lib/citations";
import { mockClassifyNews, mockExtract } from "@/lib/mock";
import { splitPages } from "@/lib/pages";
import { buildIndex, searchIndex } from "@/lib/search";
import { parseDollarAmounts } from "@/lib/text";
import { tagObligors } from "@/lib/tagging";
import type { Document } from "@/lib/types";

const OBLIGORS = [
  { id: "a", name: "City of Ashford Falls", aliases: ["Ashford Falls"] },
  { id: "b", name: "Brightwater Health System", aliases: ["Brightwater Health", "BWHS"] },
];

describe("splitPages / chunker", () => {
  it("splits on === Page N === markers and falls back to one page", () => {
    expect(splitPages("=== Page 1 ===\nAlpha\n=== Page 2 ===\nBeta")).toEqual(["Alpha", "Beta"]);
    expect(splitPages("just text")).toEqual(["just text"]);
  });

  it("is page-aware: chunks never span pages and keep their page number", () => {
    const pages = ["Page one line.\n".repeat(80), "Second page text here."];
    const chunks = chunkPages("d1", pages, 800);
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) {
      expect(pages[c.page - 1]).toContain(c.text);
      expect(c.text.length).toBeLessThanOrEqual(820);
    }
    expect(chunks.filter((c) => c.page === 2)).toHaveLength(1);
    expect(chunks.find((c) => c.page === 2)!.text).toBe("Second page text here.");
  });

  it("hard-splits a single very long line", () => {
    const chunks = chunkPages("d2", ["x".repeat(2000)], 800);
    expect(chunks.length).toBe(3);
  });
});

describe("citation verifier", () => {
  const pages = ["Nothing here.", "Days cash on hand: 118 at year end", "Third page"];
  it("keeps a correct page and marks it verified", () => {
    expect(verifyCitation(pages, { page: 2, quote: "Days cash on hand: 118" })).toEqual({ page: 2, verified: true });
  });
  it("fixes a wrong page number", () => {
    expect(verifyCitation(pages, { page: 1, quote: "days  cash on HAND: 118 at year end" })).toEqual({ page: 2, verified: true });
  });
  it("flags an unfindable quote as unverified", () => {
    expect(verifyCitation(pages, { page: 3, quote: "Operating margin: -3.1%" }).verified).toBe(false);
  });
});

describe("mock extraction", () => {
  const text = [
    "FISCAL YEAR 2024 - indicators",
    "Days cash on hand: 142",
    "Operating margin: -3.1%",
    "Debt service coverage: 1.42x",
    "Total governmental fund balance: $18,400,000",
    "Unassigned fund balance at year end was 21.3% of general fund expenditures",
    "Enrollment: 1,240",
    "Pension funded ratio: 61%",
    "Top ten taxpayers accounted for 24.8% of assessed valuation",
    "Rating: Baa2",
    "Annual rate increase: 6.5%",
  ].join("\n");
  const ex = mockExtract([text], { id: "d", title: "T", type: "audit", fiscalYear: 2023 });
  const get = (n: string) => ex.metrics.find((m) => m.name === n);

  it("extracts every metric type with the heading fiscal year", () => {
    expect(get("Days cash on hand")).toMatchObject({ value: 142, unit: "days", fiscalYear: 2024, page: 1 });
    expect(get("Operating margin")).toMatchObject({ value: -3.1, unit: "pct" });
    expect(get("Debt service coverage")).toMatchObject({ value: 1.42, unit: "x" });
    expect(get("Total governmental fund balance")).toMatchObject({ value: 18_400_000, unit: "usd" });
    expect(get("Fund balance % of expenditures")).toMatchObject({ value: 21.3, unit: "pct" });
    expect(get("Enrollment")).toMatchObject({ value: 1240, unit: "count" });
    expect(get("Pension funded ratio")).toMatchObject({ value: 61 });
    expect(get("Top-10 taxpayer concentration")).toMatchObject({ value: 24.8 });
    expect(get("Rate increase")).toMatchObject({ value: 6.5 });
    expect(ex.rating).toBe("Baa2");
  });

  it("falls back to the document fiscal year without headings", () => {
    const e = mockExtract(["Days cash on hand: 97"], { id: "d", title: "T", type: "other", fiscalYear: 2025 });
    expect(e.metrics[0]).toMatchObject({ value: 97, fiscalYear: 2025 });
  });

  it("flags events by keyword with dollar amounts", () => {
    const e = mockExtract(
      ["The board obtained a covenant waiver on $212 million of bonds.", "Moody's downgraded the City.", "Mr. Hale resigned as CFO."],
      { id: "d", title: "T", type: "board_minutes", fiscalYear: 2026 },
    );
    expect(e.events.map((x) => x.type)).toEqual(["distress", "rating", "leadership"]);
    expect(e.events[0].dollarAmount).toBe(212_000_000);
  });
});

describe("news classifier and tagging", () => {
  it("tags by name and alias, case-insensitively, with word boundaries", () => {
    expect(tagObligors("brightwater health cut jobs", OBLIGORS)).toEqual(["b"]);
    expect(tagObligors("BWHS and Ashford Falls", OBLIGORS)).toEqual(["a", "b"]);
    expect(tagObligors("Ashford Fallsington is unrelated", OBLIGORS)).toEqual([]);
  });

  it("classifies a downgrade as rating / credit relevant and tags the obligor", () => {
    const c = mockClassifyNews({ title: "Moody's downgrades Ashford Falls", text: "The city lost a notch. It has $50 million of bonds." }, OBLIGORS);
    expect(c).toMatchObject({ creditRelevant: true, eventType: "rating", obligorIds: ["a"] });
    expect(c.dollarAmounts).toEqual([50_000_000]);
  });

  it("filters a non-credit story", () => {
    const c = mockClassifyNews({ title: "Bake sale at Ashford Falls library", text: "Cookies and pies were sold on Saturday." }, OBLIGORS);
    expect(c.creditRelevant).toBe(false);
    expect(c.eventType).toBe("other");
  });

  it("parses dollar amounts with multipliers", () => {
    expect(parseDollarAmounts("$14.2 million deficit, $3,200 fee and $1.1bn")).toEqual([14_200_000, 3200, 1_100_000_000]);
  });
});

describe("MiniSearch retrieval", () => {
  it("returns the chunk containing a known phrase on the right page", () => {
    const pages = ["Introduction text about the system.", "The waiver of the debt service coverage covenant was granted.", "Other material about parking."];
    const doc = { id: "d1", title: "Minutes", chunks: chunkPages("d1", pages) } as unknown as Document;
    const hits = searchIndex(buildIndex([doc]), "What covenant waiver was granted?");
    expect(hits[0].page).toBe(2);
    expect(hits[0].text).toContain("waiver");
  });
});

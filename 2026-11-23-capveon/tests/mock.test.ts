import { describe, expect, it } from "vitest";
import { mockAnswer, mockCategory, mockExtractChanges, mockExtractRequirements, mockExtractSignals, mockStage } from "../src/lib/llm/mock";
import { quoteInText, findDates, parseMoney } from "../src/lib/util";

const fixture = `## Item 5. Riverside Pump Station Upgrade (Discussion)

Staff discussed an upgrade project for the Riverside Pump Station with a preliminary estimate of $1.2M. Council asked staff to consider funding options.

The meeting was adjourned.`;

describe("mock extraction", () => {
  it("extracts a signal from a fixture paragraph with title, category, stage, value and verbatim evidence", () => {
    const out = mockExtractSignals(fixture, "minutes", 1);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ projectTitle: "Riverside Pump Station Upgrade", category: "water", stage: "discussion", estimatedValue: 1_200_000, valueText: "$1.2M" });
    expect(quoteInText(out[0].evidenceQuote, fixture)).toBe(true);
  });
  it("extracts one signal per CIP table row", () => {
    const table = "| Project | Year | Estimate |\n|---|---|---|\n| Fernhollow Booster Station Replacement | FY2027 | $2.4M |\n| Reservoir 2 Tank Rehabilitation | FY2028 | $1.9M |";
    const out = mockExtractSignals(table, "cip", 1);
    expect(out.map((s) => s.projectTitle)).toEqual(["Fernhollow Booster Station Replacement", "Reservoir 2 Tank Rehabilitation"]);
    expect(out[0].stage).toBe("planned");
    expect(out[0].timing).toBe("FY2027");
  });
  it("ignores paragraphs without a project cue and infrastructure noun", () => {
    expect(mockExtractSignals("The meeting was called to order. Minutes were approved.", "minutes", 1)).toEqual([]);
  });
  it("classifies category and stage from cues", () => {
    expect(mockCategory("sewer lift station wet well")).toBe("wastewater");
    expect(mockCategory("culvert drainage")).toBe("stormwater");
    expect(mockCategory("pavement resurfacing")).toBe("roads_bridges");
    expect(mockStage("Council approved funding")).toBe("budgeted");
    expect(mockStage("bids due Dec 1; contract will be awarded to the lowest bidder")).toBe("solicitation");
    expect(mockStage("Contract was awarded to Acme")).toBe("awarded");
  });
  it("parses money and dates", () => {
    expect(parseMoney("about $850,000 total")?.amount).toBe(850_000);
    expect(parseMoney("est. $1.2M")?.amount).toBe(1_200_000);
    expect(findDates("from December 18, 2026 to 2027-01-08")).toEqual(["2026-12-18", "2027-01-08"]);
  });
});

describe("mock requirements, answers and changes", () => {
  it("builds one requirement per matching sentence with a kind", () => {
    const r = mockExtractRequirements("## Bonds\nEach bid shall include a bid bond of 5%.\nValves shall conform to AWWA C508.\nThe sky is blue.");
    expect(r.map((x) => x.kind)).toEqual(["bond", "certification"]);
  });
  it("answers from the best chunk with a citation and says not found otherwise", () => {
    const chunks = [
      { id: "1", documentId: "d", docTitle: "t", page: 1, text: "Sealed bids are due December 18, 2026 at 2:00 PM. Late bids are rejected." },
      { id: "2", documentId: "d", docTitle: "t", page: 3, text: "Insurance of $2,000,000 is required." },
    ];
    const a = mockAnswer("When are bids due?", chunks);
    expect(a.answer).toContain("December 18");
    expect(a.citations[0].page).toBe(1);
    const none = mockAnswer("What is the warranty period for the roof?", chunks);
    expect(none.answer).toMatch(/not found/i);
    expect(none.citations).toEqual([]);
  });
  it("extracts addendum changes including a due_date change", () => {
    const text = "1. The bid due date is extended from December 18, 2026 at 2:00 PM to January 8, 2027 at 2:00 PM.\n2. The valve specification is revised from AWWA C508 to AWWA C508 or C515.\n3. A second pump is added to the base bid.";
    const changes = mockExtractChanges(text, 1);
    expect(changes.map((c) => c.field)).toEqual(["due_date", "spec", "quantity"]);
    expect(changes[0]).toMatchObject({ before: "2026-12-18", after: "2027-01-08" });
  });
});

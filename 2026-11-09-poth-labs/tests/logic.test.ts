import { describe, expect, it } from "vitest";
import { updateConfidence } from "@/lib/confidence";
import { mockHypotheses, mockInterviewerQuestion, mockScore } from "@/lib/mock";
import { openDb } from "@/lib/db";
import { importCsv, importText } from "@/lib/importer";
import { SAMPLE_CALLS, SAMPLE_CSV, SAMPLE_TICKETS } from "@/lib/sample";

describe("updateConfidence", () => {
  it("applies +0.1 / -0.15 / 0", () => {
    expect(updateConfidence(0.5, "supports")).toBeCloseTo(0.6);
    expect(updateConfidence(0.5, "contradicts")).toBeCloseTo(0.35);
    expect(updateConfidence(0.5, "neutral")).toBe(0.5);
  });
  it("clamps to 0.02-0.98", () => {
    expect(updateConfidence(0.95, "supports")).toBe(0.98);
    expect(updateConfidence(0.1, "contradicts")).toBe(0.02);
  });
});

function seeded() {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO projects(name,question,created_at) VALUES('p','q','now')").run();
  importCsv(db, 1, SAMPLE_CSV);
  importText(db, 1, SAMPLE_TICKETS, "ticket");
  importText(db, 1, SAMPLE_CALLS, "call");
  return db;
}

describe("importer", () => {
  it("creates accounts and evidence", () => {
    const db = seeded();
    expect((db.prepare("SELECT COUNT(*) c FROM accounts").get() as any).c).toBe(12);
    expect((db.prepare("SELECT COUNT(*) c FROM evidence WHERE kind='ticket'").get() as any).c).toBe(12);
    expect((db.prepare("SELECT COUNT(*) c FROM evidence WHERE kind='call'").get() as any).c).toBe(2);
  });
});

describe("mock LLM", () => {
  const ev = () => seeded().prepare("SELECT id, kind, text, account_id FROM evidence").all() as any[];
  it("returns >=3 ranked hypotheses with evidence ids, deterministically", () => {
    const a = mockHypotheses(ev());
    expect(a.hypotheses.length).toBeGreaterThanOrEqual(3);
    expect(a.hypotheses.every((h) => h.evidenceIds.length > 0)).toBe(true);
    const c = a.hypotheses.map((h) => h.confidence);
    expect([...c].sort((x, y) => y - x)).toEqual(c);
    expect(mockHypotheses(ev())).toEqual(a);
  });
  it("interviewer adapts: probes short answers, follows up, targets hypotheses, then DONE", () => {
    const hyps = mockHypotheses(ev()).hypotheses.map((h, i) => ({ id: i + 1, statement: h.statement, confidence: h.confidence }));
    expect(mockInterviewerQuestion(hyps, [])).toMatch(/role/);
    expect(mockInterviewerQuestion(hyps, [{ role: "assistant", content: "q" }, { role: "user", content: "Not sure" }])).toMatch(/more/);
    expect(mockInterviewerQuestion(hyps, [{ role: "assistant", content: "q" }, { role: "user", content: "The price was too expensive for our small budget." }])).toMatch(/^You mentioned/);
    expect(mockInterviewerQuestion(hyps, [{ role: "assistant", content: "You mentioned x" }, { role: "user", content: "We just did not get around to it at all." }])).toMatch(/\?$/);
  });
  it("scores by keyword with negation", () => {
    const hyps = mockHypotheses(ev()).hypotheses.map((h, i) => ({ id: i + 1, statement: h.statement, confidence: h.confidence }));
    const pricing = hyps.find((h) => /Pricing/.test(h.statement))!;
    const sup = mockScore(hyps, ["The price was too expensive."]).findings.find((f) => f.hypothesisId === pricing.id)!;
    expect(sup.stance).toBe("supports");
    const con = mockScore(hyps, ["The price was fine."]).findings.find((f) => f.hypothesisId === pricing.id)!;
    expect(con.stance).toBe("contradicts");
  });
});

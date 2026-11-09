import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { priceClaim } from "./pricing";
import { SAMPLE_TERMS } from "./sample";
import { parseClaimsCsv } from "./repo";
import { askContractMock } from "./test-helpers";
import type { ClaimInput, ContractTerms } from "./types";

const claim = (o: Partial<ClaimInput>): ClaimInput => ({
  claim_id: "T1",
  patient_ref: "PT-T",
  service_date: "2026-03-01",
  code_type: "CPT",
  code: "99213",
  description: "",
  units: 1,
  billed_charges: 300,
  paid_amount: 125,
  ...o,
});

test("flat fee schedule paid correctly -> ok", () => {
  const r = priceClaim(claim({}), SAMPLE_TERMS);
  assert.equal(r.expected, 125);
  assert.equal(r.flag, "ok");
  assert.equal(r.clause_ref, "fs-99213");
});

test("flat fee schedule underpaid", () => {
  const r = priceClaim(claim({ code: "99214", paid_amount: 150 }), SAMPLE_TERMS);
  assert.equal(r.expected, 185);
  assert.equal(r.variance, 35);
  assert.equal(r.flag, "underpaid");
});

test("fee schedule multiplies by units", () => {
  const r = priceClaim(claim({ units: 2, paid_amount: 250 }), SAMPLE_TERMS);
  assert.equal(r.expected, 250);
  assert.equal(r.flag, "ok");
});

test("per diem x days", () => {
  const r = priceClaim(
    claim({ code_type: "REV", code: "0124", units: 6, billed_charges: 14000, paid_amount: 6750 }),
    SAMPLE_TERMS,
  );
  assert.equal(r.expected, 8100);
  assert.equal(r.variance, 1350);
  assert.equal(r.flag, "underpaid");
});

test("case rate without stop-loss (charges below threshold)", () => {
  const r = priceClaim(
    claim({ code_type: "DRG", code: "871", billed_charges: 48000, paid_amount: 9000 }),
    SAMPLE_TERMS,
  );
  assert.equal(r.expected, 14800);
  assert.equal(r.variance, 5800);
  assert.equal(r.clause_ref, "drg-871");
});

test("case rate with stop-loss: DRG 470 $160k billed -> $66,500", () => {
  const r = priceClaim(
    claim({ code_type: "DRG", code: "470", billed_charges: 160000, paid_amount: 42000 }),
    SAMPLE_TERMS,
  );
  assert.equal(r.expected, 66500);
  assert.equal(r.variance, 24500);
  assert.equal(r.flag, "underpaid");
  assert.equal(r.clause_ref, "stoploss-1");
  assert.match(r.reason, /\$66,500\.00 expected; paid \$42,000\.00; underpaid by \$24,500\.00\./);
});

test("carve-out percent of billed charges (not escalated)", () => {
  const r = priceClaim(
    claim({ code_type: "REV", code: "0278", billed_charges: 20000, paid_amount: 9000, service_date: "2026-09-01" }),
    SAMPLE_TERMS,
  );
  assert.equal(r.expected, 13000);
  assert.equal(r.flag, "underpaid");
  assert.equal(r.clause_ref, "carveout-0278");
});

test("escalator applies on/after effective date, not before", () => {
  const after = priceClaim(claim({ code: "29881", service_date: "2026-07-01", paid_amount: 3200, billed_charges: 9000 }), SAMPLE_TERMS);
  assert.equal(after.expected, 3296);
  assert.equal(after.flag, "underpaid");
  const before = priceClaim(claim({ code: "29881", service_date: "2026-06-30", paid_amount: 3200, billed_charges: 9000 }), SAMPLE_TERMS);
  assert.equal(before.expected, 3200);
  assert.equal(before.flag, "ok");
});

test("escalator applies to case-rate part of stop-loss only", () => {
  const r = priceClaim(
    claim({ code_type: "DRG", code: "470", service_date: "2026-08-01", billed_charges: 160000, paid_amount: 0 }),
    SAMPLE_TERMS,
  );
  assert.equal(r.expected, 25235 + 42000);
});

test("default rule for unknown code", () => {
  const r = priceClaim(claim({ code: "99999", billed_charges: 1000, paid_amount: 550 }), SAMPLE_TERMS);
  assert.equal(r.expected, 550);
  assert.equal(r.flag, "ok");
  assert.equal(r.clause_ref, "default-1");
});

test("no_rate_found when no default rule", () => {
  const terms: ContractTerms = { ...SAMPLE_TERMS, terms: SAMPLE_TERMS.terms.filter((t) => t.kind !== "default_rule") };
  const r = priceClaim(claim({ code: "99999" }), terms);
  assert.equal(r.expected, null);
  assert.equal(r.flag, "no_rate_found");
  assert.equal(r.variance, null);
});

test("overpaid", () => {
  const r = priceClaim(claim({ code: "45378", billed_charges: 2800, paid_amount: 1100 }), SAMPLE_TERMS);
  assert.equal(r.expected, 950);
  assert.equal(r.variance, -150);
  assert.equal(r.flag, "overpaid");
});

test("small variance under $25 tolerance is ok", () => {
  const r = priceClaim(claim({ code: "99213", paid_amount: 110 }), SAMPLE_TERMS);
  assert.equal(r.flag, "ok");
});

test("sample claims CSV yields the designed flags", () => {
  const csv = fs.readFileSync(path.resolve(process.cwd(), "data/sample-claims.csv"), "utf8");
  const { rows, errors } = parseClaimsCsv(csv);
  assert.deepEqual(errors, []);
  assert.equal(rows.length, 14);
  const res = rows.map((c) => priceClaim(c, SAMPLE_TERMS));
  const count = (f: string) => res.filter((r) => r.flag === f).length;
  assert.equal(count("underpaid"), 7);
  assert.equal(count("overpaid"), 1);
  assert.equal(count("ok"), 6);
  assert.equal(count("no_rate_found"), 0);
});

test("every SAMPLE_TERMS source_clause is verbatim in the sample contract", () => {
  const text = fs.readFileSync(path.resolve(process.cwd(), "data/sample-contract.md"), "utf8");
  for (const t of SAMPLE_TERMS.terms) {
    assert.ok(text.includes(t.source_clause), `clause for ${t.id} not verbatim`);
    assert.ok(t.source_clause.length <= 400);
  }
});

test("mock ask answers stop-loss question with threshold and percent", () => {
  const a = askContractMock("What is the stop-loss threshold?");
  assert.match(a, /100,000/);
  assert.match(a, /70/);
  assert.match(askContractMock("What is the weather on Mars?"), /not in the contract/);
});

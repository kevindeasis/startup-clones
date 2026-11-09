import type { ClaimInput, ContractTerms, Flag, Term } from "./types";
import { money, round2 } from "./format";

export interface PriceResult {
  expected: number | null;
  variance: number | null;
  flag: Flag;
  reason: string;
  clause_ref: string | null;
}

const LOOKUP_ORDER: Term["kind"][] = [
  "carve_out",
  "case_rate",
  "per_diem",
  "fee_schedule",
  "percent_of_charges",
];

function matchTerm(terms: ContractTerms, claim: ClaimInput): Term | undefined {
  for (const kind of LOOKUP_ORDER) {
    const hit = terms.terms.find((t) => {
      if (t.kind !== kind) return false;
      if (t.code === undefined || String(t.code) !== String(claim.code)) return false;
      if (t.code_type && t.code_type !== claim.code_type) return false;
      // The term must carry the number we need to price with.
      if (kind === "carve_out" || kind === "percent_of_charges") return t.percent !== undefined;
      return t.rate !== undefined;
    });
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Deterministic expected-payment computation. No LLM involved: results are auditable.
 * Rules are in SPEC.md section 5.
 */
export function priceClaim(claim: ClaimInput, terms: ContractTerms): PriceResult {
  const label = `${claim.code_type} ${claim.code}`;
  const escalator = terms.terms.find(
    (t) => t.kind === "escalator" && t.percent !== undefined && t.effective_from !== undefined,
  );
  const escActive = !!escalator && claim.service_date >= (escalator.effective_from as string);
  const mult = escActive ? 1 + (escalator!.percent as number) / 100 : 1;
  const escNote = escActive
    ? ` increased ${escalator!.percent}% by the escalator effective ${escalator!.effective_from}`
    : "";

  let expected: number | null = null;
  let clauseRef: string | null = null;
  let explain = "";

  const term = matchTerm(terms, claim);

  if (term) {
    clauseRef = term.id;
    if (term.kind === "carve_out" || term.kind === "percent_of_charges") {
      const pct = term.percent as number;
      expected = (pct / 100) * claim.billed_charges;
      const what = term.kind === "carve_out" ? "carve-out" : "percent-of-charges";
      explain = `${label} ${what} ${pct}% of billed charges ${money(claim.billed_charges)} = ${money(round2(expected))} expected`;
    } else if (term.kind === "fee_schedule" || term.kind === "per_diem") {
      const rate = term.rate as number;
      const base = rate * claim.units;
      expected = base * mult;
      const unitWord = term.kind === "per_diem" ? "day(s)" : "unit(s)";
      const what = term.kind === "per_diem" ? "per diem" : "fee schedule rate";
      explain = `${label} ${what} ${money(rate)} × ${claim.units} ${unitWord} = ${money(round2(base))}`;
      if (escActive) explain += `;${escNote} → ${money(round2(expected))}`;
      explain += " expected";
    } else {
      // case_rate
      const rate = term.rate as number;
      const caseAmt = rate * mult;
      expected = caseAmt;
      explain = `${label} case rate ${money(rate)}`;
      if (escActive) explain += `${escNote} → ${money(round2(caseAmt))}`;
      const stop = terms.terms.find(
        (t) =>
          t.kind === "stop_loss" &&
          t.threshold !== undefined &&
          t.percent !== undefined &&
          (t.applies_to === undefined || t.applies_to === "inpatient" || t.applies_to === "all"),
      );
      if (stop && claim.billed_charges > (stop.threshold as number)) {
        const over = claim.billed_charges - (stop.threshold as number);
        const add = ((stop.percent as number) / 100) * over;
        expected = caseAmt + add;
        clauseRef = stop.id;
        explain += `; billed charges ${money(claim.billed_charges)} exceed stop-loss threshold ${money(stop.threshold)} → ${money(round2(caseAmt))} + ${stop.percent}% × ${money(round2(over))} (${money(round2(add))}) = ${money(round2(expected))} expected`;
      } else {
        explain += " expected";
      }
    }
  } else {
    const def = terms.terms.find((t) => t.kind === "default_rule" && t.percent !== undefined);
    if (def) {
      clauseRef = def.id;
      expected = ((def.percent as number) / 100) * claim.billed_charges;
      explain = `${label} is not listed in the contract; default rule ${def.percent}% × billed charges ${money(claim.billed_charges)} = ${money(round2(expected))} expected`;
    }
  }

  if (expected === null) {
    return {
      expected: null,
      variance: null,
      flag: "no_rate_found",
      reason: `${label} is not listed in the contract and no default payment rule was found; paid ${money(claim.paid_amount)}. Manual review needed.`,
      clause_ref: null,
    };
  }

  expected = round2(expected);
  const variance = round2(expected - claim.paid_amount);
  const tol = Math.max(25, 0.01 * expected);
  let flag: Flag = "ok";
  if (variance >= tol) flag = "underpaid";
  else if (variance <= -tol) flag = "overpaid";

  const tail =
    flag === "underpaid"
      ? `underpaid by ${money(variance)}.`
      : flag === "overpaid"
        ? `overpaid by ${money(-variance)}.`
        : "payment matches the contract (within tolerance).";
  return {
    expected,
    variance,
    flag,
    reason: `${explain}; paid ${money(claim.paid_amount)}; ${tail}`,
    clause_ref: clauseRef,
  };
}

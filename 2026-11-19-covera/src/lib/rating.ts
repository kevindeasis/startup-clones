import { getIndustry } from "./data";
import type { Carrier, Line, PortalLineResult, RiskProfile } from "./types";

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

export function sizeFactor(carrier: Carrier, line: Line, profile: RiskProfile): number {
  if (line === "wc") {
    const p = profile.annualPayroll;
    return p === undefined ? 1 : round3(clamp(Math.sqrt(p / carrier.rating.payrollRef), 0.5, 5));
  }
  if (line === "auto") {
    return Math.max(1, profile.vehicles ?? 1);
  }
  const r = profile.annualRevenue;
  return r === undefined ? 1 : round3(clamp(Math.sqrt(r / carrier.rating.revenueRef), 0.5, 4));
}

export function claimsFactor(profile: RiskProfile): number {
  return 1 + 0.15 * (profile.priorClaims?.count ?? 0);
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}

export function industryMultiplier(carrier: Carrier, industry: string | undefined): number {
  return (industry && carrier.rating.industryMultipliers[industry]) || 1;
}

/** premium = round(base[line] * industryMult * sizeFactor * claimsFactor). Pure and deterministic. */
export function ratePremium(carrier: Carrier, line: Line, profile: RiskProfile): number | undefined {
  const lr = carrier.rating.lines[line];
  if (!lr) return undefined;
  return Math.round(
    lr.base * industryMultiplier(carrier, profile.industry) * sizeFactor(carrier, line, profile) * claimsFactor(profile),
  );
}

export function rateLine(carrier: Carrier, line: Line, profile: RiskProfile): PortalLineResult {
  const lr = carrier.rating.lines[line];
  if (!lr) return { line, status: "declined", reason: `${carrier.name} does not write ${line}` };
  const grade = getIndustry(profile.industry)?.hazardGrade ?? 3;
  const idx = Math.min(lr.deductibleOptions.length - 1, Math.floor((grade - 1) / 2));
  return {
    line,
    status: "quoted",
    premium: ratePremium(carrier, line, profile),
    deductible: lr.deductibleOptions[idx],
    limits: { ...lr.limits },
    coverages: [...lr.coverages],
    exclusions: [...lr.exclusions],
  };
}

/** Appetite check: returns a decline reason or undefined when in appetite. */
export function appetiteDecline(carrier: Carrier, profile: RiskProfile): string | undefined {
  const a = carrier.appetite;
  if (profile.industry && a.industriesDeclined.includes(profile.industry)) {
    return `${carrier.name} does not write ${profile.industry} risks`;
  }
  const state = profile.address?.state?.toUpperCase();
  if (state && a.statesDeclined.includes(state)) {
    return `${carrier.name} does not write in ${state}`;
  }
  if (a.maxRevenue !== undefined && profile.annualRevenue !== undefined && profile.annualRevenue > a.maxRevenue) {
    return `Revenue exceeds ${carrier.name}'s maximum of $${a.maxRevenue.toLocaleString("en-US")}`;
  }
  for (const rule of a.declineWhen) {
    if (profile.industry === rule.industry && profile.requestedLines.includes(rule.requestedLine)) {
      return rule.reason;
    }
  }
  return undefined;
}

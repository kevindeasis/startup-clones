import { getPath, isPresent } from "./path";
import type { Line, MissingItem, RiskProfile } from "./types";

export const FIELD_LABELS: Record<string, string> = {
  businessName: "Legal business name",
  "address.state": "State of operations",
  industry: "Industry / type of operations",
  "building.squareFeet": "Building square footage",
  annualRevenue: "Annual revenue",
  annualPayroll: "Annual payroll",
  employees: "Number of employees",
  vehicles: "Number of vehicles",
  notes: "Share of sales from liquor",
};

type Req = { field: string; why: string };

const GENERAL: Req[] = [
  { field: "businessName", why: "Needed to open any carrier submission" },
  { field: "address.state", why: "Appetite and rating are state specific" },
  { field: "industry", why: "Drives class code and appetite" },
];

const BY_LINE: Record<Line, Req[]> = {
  bop: [
    { field: "building.squareFeet", why: "BOP property rating needs building size" },
    { field: "annualRevenue", why: "BOP liability exposure is rated on revenue" },
  ],
  gl: [{ field: "annualRevenue", why: "GL exposure is rated on revenue" }],
  wc: [
    { field: "annualPayroll", why: "Workers' comp premium is rated on payroll" },
    { field: "employees", why: "Headcount is required on the WC application" },
  ],
  auto: [{ field: "vehicles", why: "Auto premium is rated per power unit" }],
  cyber: [
    { field: "annualRevenue", why: "Cyber limits and pricing scale with revenue" },
    { field: "employees", why: "Cyber underwriting asks for headcount" },
  ],
  liquor: [{ field: "annualRevenue", why: "Liquor liability is rated on sales" }],
};

export function mentionsLiquorShare(profile: RiskProfile): boolean {
  const notes = profile.notes ?? "";
  return /liquor|alcohol/i.test(notes) && /\d+(?:\.\d+)?\s*(?:%|percent)/i.test(notes);
}

export function computeMissing(profile: RiskProfile): MissingItem[] {
  const out: MissingItem[] = [];
  for (const r of GENERAL) {
    if (!isPresent(getPath(profile, r.field))) out.push({ line: "general", field: r.field, why: r.why });
  }
  for (const line of profile.requestedLines ?? []) {
    for (const r of BY_LINE[line] ?? []) {
      if (!isPresent(getPath(profile, r.field))) out.push({ line, field: r.field, why: r.why });
    }
    if (line === "liquor" && !mentionsLiquorShare(profile)) {
      out.push({ line, field: "notes", why: "Carriers need the percentage of sales from liquor" });
    }
  }
  return out;
}

export function uniqueMissingFields(missing: MissingItem[]): { field: string; label: string; lines: string[] }[] {
  const map = new Map<string, { field: string; label: string; lines: string[] }>();
  for (const m of missing) {
    const e = map.get(m.field) ?? { field: m.field, label: FIELD_LABELS[m.field] ?? m.field, lines: [] };
    e.lines.push(m.line);
    map.set(m.field, e);
  }
  return [...map.values()];
}

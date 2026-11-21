import type { Metric, Unit } from "./types";

export function fmtUsd(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v}`;
}

export function fmtValue(value: number, unit: Unit): string {
  switch (unit) {
    case "usd":
      return fmtUsd(value);
    case "pct":
      return `${value.toFixed(1)}%`;
    case "days":
      return `${Math.round(value)} days`;
    case "x":
      return `${value.toFixed(2)}x`;
    default:
      return Math.round(value).toLocaleString("en-US");
  }
}

export const fmtMetric = (m: Pick<Metric, "value" | "unit">) => fmtValue(m.value, m.unit);

export const SECTOR_LABEL: Record<string, string> = {
  city: "City",
  county: "County",
  hospital: "Hospital",
  water_utility: "Water utility",
  school: "School",
  airport: "Airport",
  university: "University",
};

export const TYPE_LABEL: Record<string, string> = {
  rating: "Rating",
  distress: "Distress",
  state_oversight: "State oversight",
  leadership: "Leadership",
  litigation: "Litigation",
  budget: "Budget",
  debt_issuance: "Debt issuance",
  other: "Other",
};

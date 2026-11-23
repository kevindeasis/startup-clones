import type { Category, FitBreakdown, Profile } from "./types";

const WATER_GROUP: Category[] = ["water", "wastewater", "stormwater"];

export function categoryPoints(profile: Pick<Profile, "categories">, cat: Category): number {
  if (profile.categories.includes(cat)) return 40;
  if (WATER_GROUP.includes(cat) && profile.categories.some((c) => WATER_GROUP.includes(c))) return 15;
  return 0;
}

export function keywordPoints(profile: Pick<Profile, "keywords">, text: string): { points: number; matched: string[] } {
  const hay = text.toLowerCase();
  const matched = profile.keywords.filter((k) => k.trim() && hay.includes(k.trim().toLowerCase()));
  // 30 points; reaching 4 matching keywords (or all, if the profile has fewer) earns the full amount.
  const cap = Math.max(1, Math.min(4, profile.keywords.length));
  return { points: Math.round(30 * Math.min(1, matched.length / cap)), matched };
}

export function regionPoints(profile: Pick<Profile, "regions">, agencyRegion: string): number {
  const r = agencyRegion.toLowerCase();
  return profile.regions.some((p) => p.trim() && r.includes(p.trim().toLowerCase())) ? 15 : 0;
}

export function valuePoints(profile: Pick<Profile, "minValue" | "maxValue">, value?: number): number {
  if (value === undefined || value === null) return 7;
  return value >= profile.minValue && value <= profile.maxValue ? 15 : 0;
}

export interface FitInput {
  category: Category;
  title: string;
  summary: string;
  evidence: string;
  estimatedValue?: number;
  agencyRegion: string;
}

export interface FitResult {
  score: number;
  breakdown: FitBreakdown;
  matchedKeywords: string[];
}

export function scoreFit(profile: Profile, input: FitInput): FitResult {
  const kw = keywordPoints(profile, `${input.title} ${input.summary} ${input.evidence}`);
  const breakdown: FitBreakdown = {
    category: categoryPoints(profile, input.category),
    keywords: kw.points,
    region: regionPoints(profile, input.agencyRegion),
    value: valuePoints(profile, input.estimatedValue),
  };
  const score = Math.min(100, breakdown.category + breakdown.keywords + breakdown.region + breakdown.value);
  return { score, breakdown, matchedKeywords: kw.matched };
}

export type FitBand = "strong" | "possible" | "weak";
export function fitBand(score: number): FitBand {
  return score >= 70 ? "strong" : score >= 40 ? "possible" : "weak";
}

/** Deterministic one-liner used by mock mode and when rescoring after a profile change. */
export function templateRationale(
  profile: Pick<Profile, "name">,
  b: FitBreakdown,
  matched: string[],
  category: string,
): string {
  const parts: string[] = [];
  parts.push(b.category === 40 ? `${category} is a core category` : b.category > 0 ? `${category} is adjacent to your categories` : `${category} is outside your categories`);
  parts.push(matched.length ? `matches ${matched.slice(0, 3).join(", ")}` : "no product keyword overlap");
  parts.push(b.region ? "in your region" : "outside your regions");
  parts.push(b.value === 15 ? "value in your band" : b.value === 7 ? "value not stated" : "value outside your band");
  return `${parts.join("; ")}.`;
}

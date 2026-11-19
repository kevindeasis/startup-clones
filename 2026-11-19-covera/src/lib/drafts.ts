import type { Account, ComparisonDiff, Gap, RiskProfile } from "./types";

export type DraftKind = "followUp" | "recommendation" | "proposal" | "outreach";

export type DraftContexts = {
  followUp: { profile: RiskProfile; missing: { field: string; label: string; lines: string[] }[] };
  recommendation: { profile: RiskProfile; diff: ComparisonDiff; recommendedQuoteId?: string };
  proposal: { profile: RiskProfile; diff: ComparisonDiff; recommendedQuoteId?: string };
  outreach: { account: Account; gap: Gap; industryName?: string };
};

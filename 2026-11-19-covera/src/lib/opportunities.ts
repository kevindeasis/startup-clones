import { uniqueMissingFields, computeMissing } from "./requirements";
import { draftText, extractRiskProfile } from "./llm";
import { newId } from "./store";
import type { Opportunity, RiskProfile } from "./types";

export async function analyse(profile: RiskProfile) {
  const missing = computeMissing(profile);
  const followUpEmail = await draftText("followUp", { profile, missing: uniqueMissingFields(missing) });
  return { missing, followUpEmail };
}

export async function buildOpportunity(input: {
  text: string;
  attachments: { filename: string; text: string }[];
  combinedText: string;
  profile?: RiskProfile;
}): Promise<Opportunity> {
  const profile = input.profile ?? (await extractRiskProfile(input.combinedText));
  const { missing, followUpEmail } = await analyse(profile);
  return {
    id: newId("opp"),
    createdAt: new Date().toISOString(),
    stage: missing.length ? "needs_info" : "intake",
    sourceText: input.text,
    attachments: input.attachments,
    profile,
    missing,
    followUpEmail,
    quotes: [],
  };
}

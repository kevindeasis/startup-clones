import { anthropic } from "@ai-sdk/anthropic";
import { generateObject, generateText } from "ai";
import { mockExtractRiskProfile } from "./mock-extract";
import { mockDraft } from "./mock-drafts";
import { riskProfileSchema } from "./schemas";
import type { DraftContexts, DraftKind } from "./drafts";
import type { RiskProfile } from "./types";

export type { DraftContexts, DraftKind } from "./drafts";

export function isMock(): boolean {
  return process.env.LLM_MOCK === "1" || !process.env.ANTHROPIC_API_KEY;
}

export function modelId(): string {
  return process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
}

const EXTRACTION_SYSTEM = `You are a commercial-lines customer service rep at an independent P&C insurance agency.
Read the client's email (and any attachment text) and fill in the risk profile.
Rules: leave unknown fields undefined; never guess revenue, payroll or headcount; normalise requested lines to the enum
(bop, gl, wc, auto, cyber, liquor); use industry ids such as restaurant, retail, contractor, professional-services,
e-commerce, landscaping, auto-repair, bakery, salon, software, trucking, wholesale; parse dates to ISO YYYY-MM-DD;
use two-letter state codes; amounts are in USD per year.`;

export async function extractRiskProfile(text: string): Promise<RiskProfile> {
  if (isMock()) return mockExtractRiskProfile(text);
  const { object } = await generateObject({
    model: anthropic(modelId()),
    schema: riskProfileSchema,
    system: EXTRACTION_SYSTEM,
    prompt: text,
  });
  return object;
}

const DRAFT_SYSTEM = `You are a licensed commercial insurance broker's assistant writing on behalf of Harbor Point Insurance.
Write concise, professional, plain-text emails or paragraphs. Only cite numbers and facts present in the provided data.
A human broker reviews everything before it is sent; never claim coverage is bound.`;

const DRAFT_INSTRUCTIONS: Record<DraftKind, string> = {
  followUp: "Draft a short follow-up email to the client asking for each missing item listed in the data. If the missing list is empty, instead write a short confirmation: thank the client, say the agency has everything needed for the requested lines, and that it is going to market with carriers now.",
  recommendation: "Write a 4-6 sentence recommendation comparing the quotes: cheapest vs broadest coverage and which to pick. Cite only numbers in the table.",
  proposal: "Write a client-ready proposal email summarising the recommended quote and alternatives. Cite only numbers in the table. Ask the client to confirm so the broker can proceed.",
  outreach: "Write a short cross-sell outreach email to the account explaining the coverage gap and offering a call.",
};

export async function draftText<K extends DraftKind>(kind: K, context: DraftContexts[K]): Promise<string> {
  if (isMock()) return mockDraft(kind, context);
  const { text } = await generateText({
    model: anthropic(modelId()),
    system: DRAFT_SYSTEM,
    prompt: `${DRAFT_INSTRUCTIONS[kind]}\n\nData (JSON):\n${JSON.stringify(context, null, 2)}`,
  });
  return text.trim();
}

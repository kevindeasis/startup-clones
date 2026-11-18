import { structured, isMock, mockReviewObject, reviewAiSchema } from "./llm";
import { getPermitType, getSection } from "./permits";
import { REVIEW_SYSTEM, reviewPrompt } from "./prompts";
import { runRules } from "./rules";
import type { Application, Check, CodeSection, Review } from "./types";

export async function reviewApplication(app: Application): Promise<Review> {
  const permit = getPermitType(app.permitType);
  if (!permit) throw new Error(`Unknown permit type ${app.permitType}`);
  const ruleChecks = runRules(permit, app.fields, app.attachments);
  const cited = [...new Set(ruleChecks.map((c) => c.citation))]
    .map((id) => getSection(id))
    .filter((s): s is CodeSection => !!s);
  const ai = await structured({
    system: REVIEW_SYSTEM,
    prompt: reviewPrompt(app, ruleChecks, cited),
    schema: reviewAiSchema,
    mock: () => mockReviewObject(app, ruleChecks),
  });
  // AI may add checks but never changes rule statuses.
  const extra: Check[] = ai.extraChecks.map((c, i) => ({
    id: `ai-${i + 1}`,
    title: c.title,
    status: c.status,
    citation: c.citation || "17.50.010",
    detail: c.detail,
    source: "ai",
  }));
  return {
    checks: [...ruleChecks, ...extra],
    summary: ai.summary,
    recommendation: ai.recommendation,
    conditions: ai.conditions,
    createdAt: new Date().toISOString(),
    mock: isMock(),
  };
}

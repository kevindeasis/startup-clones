import { z } from "zod";

export const PRACTICE_AREAS = ["commercial", "employment", "corporate", "privacy", "general"] as const;
export const URGENCIES = ["P0", "P1", "P2", "P3"] as const;
export const CHANNELS = ["email", "slack", "teams", "webhook"] as const;

export const TriageOutput = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  practice_area: z.enum(PRACTICE_AREAS),
  urgency: z.enum(URGENCIES),
  urgency_reason: z.string(),
  ask: z.string(),
  missing_info: z.array(z.string()),
  key_terms: z.array(z.object({ label: z.string(), value: z.string() })),
  dates: z.array(z.object({ label: z.string(), date: z.string() })),
  decision_required: z.boolean(),
  decision: z.object({
    question: z.string(),
    options: z.array(
      z.object({
        label: z.string(),
        rationale: z.string(),
        risk: z.string(),
        citations: z.array(z.string()),
      }),
    ),
    recommended_label: z.string(),
  }),
  redline: z.array(
    z.object({
      clause_quote: z.string(),
      issue: z.string(),
      proposed_language: z.string(),
      citations: z.array(z.string()),
    }),
  ),
  draft_reply: z.string().min(1),
  citations_used: z.array(z.string()),
});
export type TriageOutput = z.infer<typeof TriageOutput>;

export const ClarifyOutput = z.object({ message: z.string().min(1) });

export const IntakeBody = z.object({
  channel: z.enum(CHANNELS),
  requester_name: z.string().min(1),
  requester_email: z.string().optional(),
  subject: z.string().min(1),
  body: z.string().min(1),
  attachments: z.array(z.object({ name: z.string(), text: z.string() })).optional(),
});
export type IntakeBody = z.infer<typeof IntakeBody>;

export const ActionBody = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), chosen_option: z.string().optional(), draft_reply: z.string().optional() }),
  z.object({ action: z.literal("request_info") }),
  z.object({ action: z.literal("reassign"), owner_id: z.string().min(1) }),
  z.object({ action: z.literal("close") }),
  z.object({ action: z.literal("save_reply"), draft_reply: z.string() }),
  z.object({ action: z.literal("choose_option"), chosen_option: z.string() }),
]);
export type ActionBody = z.infer<typeof ActionBody>;

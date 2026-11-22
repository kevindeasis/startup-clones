import { z } from "zod";

export const kickoffPlanSchema = z.object({
  goals: z.array(z.string()),
  tasks: z.array(z.object({
    title: z.string(),
    ownerSide: z.enum(["vendor", "customer"]),
    ownerName: z.string().optional(),
    dueInDays: z.number(),
    isBlocker: z.boolean(),
  })),
  blockers: z.array(z.object({ description: z.string(), taskTitle: z.string() })),
  stakeholders: z.array(z.object({ name: z.string(), role: z.string(), side: z.enum(["vendor", "customer"]) })),
  risks: z.array(z.string()),
  recap: z.string(),
});
export type KickoffPlan = z.infer<typeof kickoffPlanSchema>;

export const signalSchema = z.object({
  relevant: z.boolean(),
  accountIds: z.array(z.string()),
  signalType: z.enum(["acquisition", "funding", "leadership_change", "hiring", "layoffs", "outage", "competitor", "other"]),
  direction: z.enum(["expansion", "risk", "neutral"]),
  summary: z.string(),
  suggestedPlay: z.enum(["expansion_project", "champion_note", "exec_check_in", "none"]),
});
export type SignalClass = z.infer<typeof signalSchema>;

export const explainSchema = z.object({ rationale: z.string(), nextSteps: z.array(z.string()) });
export const briefSchema = z.object({ markdown: z.string() });
export const answerSchema = z.object({ answer: z.string() });

// request bodies
export const kickoffBody = z.object({ transcript: z.string().min(40, "transcript is too short") });
export const askBody = z.object({ question: z.string().min(2) });
export const radarBody = z.object({
  title: z.string().min(1),
  text: z.string().min(1),
  source: z.string().min(1).default("paste"),
  url: z.string().optional(),
  publishedAt: z.string().optional(),
});
export const actionBody = z.object({ op: z.enum(["accept", "snooze", "dismiss"]) });
export const taskBody = z.object({ done: z.boolean() });
export const analyzeBody = z.object({ accountId: z.string().optional() });
export const usageRow = z.object({
  week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  active_users: z.coerce.number().min(0),
  metered_units: z.coerce.number().min(0),
  tickets_opened: z.coerce.number().min(0).default(0),
});
export const usageBody = z.union([
  z.array(usageRow).min(1),
  z.object({ rows: z.array(usageRow).min(1) }),
]);

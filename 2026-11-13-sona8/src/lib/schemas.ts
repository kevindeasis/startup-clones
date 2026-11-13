import { z } from "zod";

export const AREAS = [
  "trigger",
  "steps",
  "tools",
  "manual_work",
  "handoffs",
  "exceptions",
  "pain_points",
] as const;
export const Area = z.enum(AREAS);
export type Area = z.infer<typeof Area>;

export const AREA_LABELS: Record<Area, string> = {
  trigger: "Trigger",
  steps: "Steps",
  tools: "Tools",
  manual_work: "Manual work",
  handoffs: "Handoffs",
  exceptions: "Exceptions",
  pain_points: "Pain points",
};

const Severity = z.enum(["low", "medium", "high"]);
export type Severity = z.infer<typeof Severity>;

export const InterviewExtraction = z.object({
  summary: z.string(),
  trigger: z.string(),
  steps: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      actorRole: z.string(),
      tools: z.array(z.string()),
      manual: z.boolean(),
      durationHint: z.string().optional(),
      notes: z.string().optional(),
    }),
  ),
  handoffs: z.array(
    z.object({ fromStep: z.string(), toStep: z.string(), toRole: z.string(), channel: z.string() }),
  ),
  exceptions: z.array(z.object({ condition: z.string(), whatHappens: z.string() })),
  painPoints: z.array(
    z.object({
      description: z.string(),
      severity: Severity,
      quote: z.string(),
      relatedStepIds: z.array(z.string()),
    }),
  ),
  automationCandidates: z.array(
    z.object({
      stepIds: z.array(z.string()),
      idea: z.string(),
      confidence: z.enum(["low", "medium", "high"]),
    }),
  ),
  coverage: z.array(Area),
});
export type InterviewExtraction = z.infer<typeof InterviewExtraction>;

export const StudySynthesis = z.object({
  headline: z.string(),
  mergedSteps: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      actorRole: z.string(),
      tools: z.array(z.string()),
      manual: z.boolean(),
      mentionedBy: z.number(),
      variants: z.array(z.string()).optional(),
    }),
  ),
  edges: z.array(z.object({ from: z.string(), to: z.string(), label: z.string().optional() })),
  exceptions: z.array(
    z.object({ condition: z.string(), whatHappens: z.string(), mentionedBy: z.number() }),
  ),
  painPoints: z.array(
    z.object({
      description: z.string(),
      severity: Severity,
      count: z.number(),
      teams: z.array(z.string()),
      sites: z.array(z.string()),
      quote: z.string(),
    }),
  ),
  recommendations: z.array(
    z.object({
      type: z.enum(["eliminate", "automate", "standardise", "clarify_owner"]),
      title: z.string(),
      rationale: z.string(),
      stepIds: z.array(z.string()),
    }),
  ),
  openQuestions: z.array(z.string()),
});
export type StudySynthesis = z.infer<typeof StudySynthesis>;

// API bodies
export const CreateStudyBody = z.object({
  title: z.string().trim().min(1),
  topic: z.string().trim().min(1),
  goal: z.string().trim().default(""),
  teams: z.array(z.string().trim().min(1)).default([]),
});
export const CreateParticipantBody = z.object({
  name: z.string().trim().default(""),
  team: z.string().trim().default(""),
  site: z.string().trim().default(""),
  role: z.string().trim().default(""),
});
export const ChatBody = z.object({ message: z.string().trim().min(1).max(4000) });

export type Study = {
  id: string;
  title: string;
  topic: string;
  goal: string;
  teams: string[];
  createdAt: string;
};
export type ParticipantStatus = "invited" | "in_progress" | "completed";
export type Participant = {
  id: string;
  studyId: string;
  token: string;
  name: string;
  team: string;
  site: string;
  role: string;
  status: ParticipantStatus;
  createdAt: string;
  completedAt: string | null;
};
export type ChatMessage = { role: "user" | "assistant"; content: string };

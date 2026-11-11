import { z } from "zod";

export const PATTERNS = [
  "over-apologising",
  "vague-ask",
  "no-question-back",
  "too-long",
  "hedging",
  "defensive",
  "monologue",
  "fine",
] as const;
export const PatternSchema = z.enum(PATTERNS);
export type Pattern = z.infer<typeof PatternSchema>;

export const VerdictSchema = z.enum(["landed", "okay", "backfired"]);
export type Verdict = z.infer<typeof VerdictSchema>;

/** What the LLM returns for post-session feedback (snake_case, as in the prompt). */
export const FeedbackLLMSchema = z.object({
  score: z.number().min(0).max(100),
  summary: z.string(),
  weakest_line_index: z.number().int(),
  pattern: PatternSchema,
  lines: z.array(
    z.object({
      index: z.number().int(),
      verdict: VerdictSchema,
      reason: z.string(),
      stronger: z.string().optional(),
    }),
  ),
});
export type FeedbackLLM = z.infer<typeof FeedbackLLMSchema>;

export const DrillLLMSchema = z.object({
  verdict: VerdictSchema,
  note: z.string(),
  model_answer: z.string(),
});
export type DrillLLM = z.infer<typeof DrillLLMSchema>;

export const ScenarioDraftSchema = z.object({
  title: z.string(),
  character: z.string(),
  persona: z.string(),
  setting: z.string(),
  stakes: z.string(),
  goal: z.string(),
});
export type ScenarioDraft = z.infer<typeof ScenarioDraftSchema>;

// ---- stored data model ----
export interface Unit {
  id: string;
  order: number;
  title: string;
  blurb: string;
}
export interface Scenario extends ScenarioDraft {
  id: string;
  unitId: string;
  order: number;
  type: string;
  custom?: boolean;
}
export interface Message {
  role: "user" | "partner";
  text: string;
  index: number;
}
export interface FeedbackLine {
  index: number;
  verdict: Verdict;
  reason: string;
  stronger?: string;
}
export interface Feedback {
  score: number;
  summary: string;
  weakestLineIndex: number;
  pattern: Pattern;
  lines: FeedbackLine[];
}
export interface Session {
  id: string;
  scenarioId: string;
  startedAt: string;
  endedAt?: string;
  messages: Message[];
  feedback?: Feedback;
  mock: boolean;
  focus?: Pattern;
}
export interface DrillAttempt {
  text: string;
  verdict: Verdict;
  note: string;
  modelAnswer: string;
}
export interface Drill {
  id: string;
  sessionId: string;
  lineIndex: number;
  attempts: DrillAttempt[];
  done: boolean;
}
export interface DbShape {
  units: Unit[];
  scenarios: Scenario[];
  sessions: Session[];
  drills: Drill[];
}

export const MAX_USER_LINES = 6;
export const MAX_DRILL_ATTEMPTS = 3;
export const OPENING_SENTINEL = "[The scene begins. Say your opening line.]";

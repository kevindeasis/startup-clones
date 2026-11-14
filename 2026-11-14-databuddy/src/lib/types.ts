import { z } from "zod";

export const RANGES = ["24h", "7d", "30d"] as const;
export type Range = (typeof RANGES)[number];

export const StepSchema = z.object({
  kind: z.enum(["path", "event"]),
  value: z.string().trim().min(1).max(300),
});
export type Step = z.infer<typeof StepSchema>;

export type Site = { id: string; name: string; domain: string; created_at: string };
export type Funnel = { id: string; site_id: string; name: string; steps: Step[] };
export type Goal = { id: string; site_id: string; name: string; kind: "path" | "event"; target: string };

export const ChartSpecSchema = z.object({
  type: z.enum(["line", "bar"]),
  x: z.string(),
  y: z.string(),
  title: z.string().optional(),
});
export type ChartSpec = z.infer<typeof ChartSpecSchema>;

export const AnalystAnswerSchema = z.object({
  answer_md: z.string().min(1),
  chart: ChartSpecSchema.optional(),
});
export type AnalystAnswer = z.infer<typeof AnalystAnswerSchema>;

export type AskResult = {
  id?: string;
  answer_md: string;
  sql: string;
  columns: string[];
  rows: Record<string, unknown>[];
  chart: ChartSpec | null;
  mode: "mock" | "llm";
};

import { z } from "zod";

export const guideSchema = z.object({ questions: z.array(z.string()).describe("5 to 8 open-ended interview questions") });

export const personasSchema = z.object({
  personas: z.array(z.object({ name: z.string(), role: z.string(), context: z.string(), attitude: z.string() })),
});
export type Persona = z.infer<typeof personasSchema>["personas"][number];

export const buyerModelSchema = z.object({
  summary: z.string(),
  themes: z.array(z.object({
    title: z.string(), description: z.string(),
    evidence: z.array(z.object({ interview_id: z.string(), quote: z.string() })),
  })),
  objections: z.array(z.string()),
  jobs_to_be_done: z.array(z.string()),
  segments: z.array(z.object({ name: z.string(), description: z.string(), share_estimate: z.string() })),
  recommended_messages: z.array(z.string()),
});
export type BuyerModel = z.infer<typeof buyerModelSchema>;

export const simulationSchema = z.object({
  reactions: z.array(z.object({
    segment: z.string(), reaction: z.string(),
    sentiment: z.number().int().describe("integer from -2 (very negative) to 2 (very positive)"),
    likely_objection: z.string(), quote_style_example: z.string(),
  })),
});
export type Reaction = z.infer<typeof simulationSchema>["reactions"][number];

export const createStudyBody = z.object({
  title: z.string().min(1), goal: z.string().min(1), audience: z.string().min(1),
  seed_questions: z.union([z.array(z.string()), z.string()]).optional(),
});

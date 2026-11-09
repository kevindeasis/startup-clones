import { z } from 'zod';

export const CriterionType = z.enum(['must_have', 'nice_to_have', 'dealbreaker']);
export const CriterionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  weight: z.number().int().min(1).max(5),
  type: CriterionType,
});
export type Criterion = z.infer<typeof CriterionSchema>;

// LLM-facing schemas
export const DraftRubricOut = z.object({
  criteria: z.array(CriterionSchema.omit({ id: true })).min(4).max(8),
});
export const Recommendation = z.enum(['advance', 'hold', 'reject']);
export type Rec = z.infer<typeof Recommendation>;

export const ReviewOut = z.object({
  criteria_scores: z.array(
    z.object({
      criterion_id: z.string(),
      score: z.number().min(0).max(5),
      evidence: z.string(),
      confidence: z.enum(['low', 'medium', 'high']),
    }),
  ),
  open_questions: z.array(z.string()),
  summary: z.string(),
  recommendation: Recommendation,
});
export type ReviewOutput = z.infer<typeof ReviewOut>;

export const ProposeOut = z.object({
  criteria: z.array(CriterionSchema.extend({ id: z.string().optional() })).min(1).max(10),
  taste_notes: z.array(z.string()),
  change_summary: z.string(),
});

export const PlanOut = z.object({
  questions: z
    .array(
      z.object({
        question: z.string(),
        probes_criterion_id: z.string(),
        strong_answer_looks_like: z.string(),
      }),
    )
    .min(6)
    .max(10),
});
export type PlanQuestion = z.infer<typeof PlanOut>['questions'][number];

// API inputs
export const CreateRoleIn = z.object({ title: z.string().min(1), job_description: z.string().min(1) });
export const SaveModelIn = z.union([
  z.object({ criteria: z.array(CriterionSchema).min(1), taste_notes: z.array(z.string()).optional() }),
  z.object({ proposal_id: z.string(), action: z.enum(['approve', 'discard']) }),
]);
export const ResumeJsonIn = z.object({ name: z.string().optional(), resume_text: z.string().min(1) });
export const DecisionIn = z.object({ decision: z.enum(['advance', 'reject']), reason: z.string().min(1) });
export const AskIn = z.object({ question: z.string().min(1) });

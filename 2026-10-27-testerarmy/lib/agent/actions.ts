import { z } from 'zod';

export const actionSchema = z.object({
  type: z.enum([
    'goto', 'click', 'fill', 'press', 'select', 'scroll', 'wait',
    'assert_text', 'assert_url_contains', 'done', 'fail',
  ]),
  url: z.string().optional().describe('for goto'),
  target: z.string().optional().describe('for click/fill/select: visible text, label, placeholder or accessible name'),
  value: z.string().optional().describe('for fill/select'),
  key: z.string().optional().describe('for press, e.g. Enter'),
  direction: z.enum(['up', 'down']).optional().describe('for scroll'),
  ms: z.number().optional().describe('for wait, <= 5000'),
  text: z.string().optional().describe('for assert_text'),
  fragment: z.string().optional().describe('for assert_url_contains'),
  summary: z.string().optional().describe('for done'),
  reason: z.string().optional().describe('for fail'),
});

export type Action = z.infer<typeof actionSchema>;

export const decisionSchema = z.object({
  action: actionSchema,
  reasoning: z.string().describe('one-line rationale'),
});

export const verdictSchema = z.object({ pass: z.boolean(), reason: z.string() });

export type Observation = {
  url: string;
  title: string;
  ariaSnapshot: string;
  stepInstruction: string;
  previousActionsInStep: { action: Action; ok: boolean; error?: string }[];
  allSteps: string[];
  expectedOutcome: string;
  /** full visible page text (used by the mock planner's verdict) */
  pageText?: string;
};

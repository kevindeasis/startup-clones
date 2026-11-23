import { z } from "zod";
import { CATEGORIES, CHANGE_FIELDS, DOC_KINDS, REQ_KINDS, STAGES } from "./types";

export const categorySchema = z.enum(CATEGORIES);
export const stageSchema = z.enum(STAGES);
export const docKindSchema = z.enum(DOC_KINDS);

// ---- LLM output schemas (nullable rather than optional: friendlier to structured outputs) ----
export const extractedSignalSchema = z.object({
  projectTitle: z.string().min(3),
  category: categorySchema,
  stage: stageSchema,
  estimatedValue: z.number().nullable(),
  valueText: z.string().nullable(),
  timing: z.string().nullable(),
  summary: z.string(),
  evidenceQuote: z.string().max(300),
  confidence: z.number().min(0).max(1),
});
export type ExtractedSignal = z.infer<typeof extractedSignalSchema>;
export const extractionOutputSchema = z.object({ signals: z.array(extractedSignalSchema) });

export const rawRequirementSchema = z.object({
  text: z.string(),
  kind: z.enum(REQ_KINDS),
  quote: z.string().max(300),
});
export type RawRequirement = z.infer<typeof rawRequirementSchema>;
export const requirementsOutputSchema = z.object({ requirements: z.array(rawRequirementSchema) });

export const citationSchema = z.object({ page: z.number().int(), quote: z.string(), documentId: z.string().optional() });
export const answerSchema = z.object({
  answer: z.string(),
  citations: z.array(citationSchema.omit({ documentId: true })),
});
export type Answer = { answer: string; citations: { page: number; quote: string; documentId?: string }[] };

export const suggestedTasksSchema = z.object({
  tasks: z.array(z.object({ title: z.string(), page: z.number().int().nullable() })).max(3),
});
export const letterSchema = z.object({ letter: z.string() });
export const rationaleSchema = z.object({ rationale: z.string() });

export const changeSchema = z.object({
  field: z.enum(CHANGE_FIELDS),
  before: z.string().nullable(),
  after: z.string().nullable(),
  summary: z.string(),
  page: z.number().int(),
  quote: z.string().max(300),
});
export const changesOutputSchema = z.object({ changes: z.array(changeSchema) });

// ---- API input schemas ----
export const profileInputSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  categories: z.array(categorySchema),
  keywords: z.array(z.string()),
  regions: z.array(z.string()),
  minValue: z.number().min(0),
  maxValue: z.number().min(0),
  certifications: z.array(z.string()),
  bondingCapacity: z.number().min(0).optional(),
  team: z.array(z.object({ name: z.string().min(1), role: z.string() })),
  pastBids: z.array(
    z.object({
      title: z.string(),
      agency: z.string(),
      year: z.number().int(),
      outcome: z.enum(["won", "lost", "pending"]),
      summary: z.string(),
    }),
  ),
});

export const documentInputSchema = z
  .object({
    title: z.string().min(1),
    agencyId: z.string().min(1).optional(),
    agencyName: z.string().min(1).optional(),
    kind: docKindSchema,
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
    text: z.string().min(1),
    parentDocumentId: z.string().min(1).optional(),
  })
  .refine((v) => v.agencyId || v.agencyName, { message: "agencyId or agencyName is required" })
  .refine((v) => v.kind !== "addendum" || !!v.parentDocumentId, {
    message: "addendum requires parentDocumentId",
  });

export const askInputSchema = z.object({ question: z.string().min(2).max(500) });
export const pursuitInputSchema = z
  .object({ signalId: z.string().optional(), documentId: z.string().optional() })
  .refine((v) => v.signalId || v.documentId, { message: "signalId or documentId is required" });
export const taskPatchSchema = z.object({ done: z.boolean() });

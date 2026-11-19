import { z } from "zod";
import type { RiskProfile } from "./types";

export const lineSchema = z.enum(["bop", "gl", "wc", "auto", "cyber", "liquor"]);

export const riskProfileSchema: z.ZodType<RiskProfile> = z.object({
  businessName: z.string().optional(),
  contactName: z.string().optional(),
  contactEmail: z.string().optional(),
  industry: z.string().optional().describe("Industry id such as restaurant, retail, contractor, e-commerce, landscaping"),
  classCode: z.string().optional(),
  description: z.string().optional(),
  address: z
    .object({
      street: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional().describe("Two-letter US state code"),
      zip: z.string().optional(),
    })
    .optional(),
  yearsInBusiness: z.number().optional(),
  annualRevenue: z.number().optional().describe("USD per year; never guess"),
  annualPayroll: z.number().optional(),
  employees: z.number().optional(),
  building: z
    .object({
      squareFeet: z.number().optional(),
      yearBuilt: z.number().optional(),
      sprinklered: z.boolean().optional(),
      owned: z.boolean().optional(),
    })
    .optional(),
  vehicles: z.number().optional(),
  priorClaims: z.object({ count: z.number(), notes: z.string().optional() }).optional(),
  requestedLines: z.array(lineSchema),
  effectiveDate: z.string().optional().describe("ISO date YYYY-MM-DD"),
  notes: z.string().optional(),
});

export const extractBodySchema = z.object({
  text: z.string().default(""),
  attachments: z.array(z.object({ filename: z.string(), base64: z.string() })).optional(),
});

export const createOpportunityBodySchema = z.object({
  text: z.string().default(""),
  attachments: z.array(z.object({ filename: z.string(), text: z.string() })).optional(),
  profile: riskProfileSchema.optional(),
});

export const patchOpportunityBodySchema = z.object({
  profile: riskProfileSchema.optional(),
  selectedQuoteId: z.string().optional(),
});

export const outreachBodySchema = z.object({ accountId: z.string(), line: lineSchema });

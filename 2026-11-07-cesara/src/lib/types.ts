import { z } from "zod";

export const TermKind = z.enum([
  "fee_schedule",
  "case_rate",
  "per_diem",
  "percent_of_charges",
  "carve_out",
  "stop_loss",
  "escalator",
  "default_rule",
  "admin",
]);

export const TermSchema = z.object({
  id: z.string().describe('Stable id, e.g. "fs-99213", "drg-470", "stoploss-1"'),
  kind: TermKind,
  code_type: z.enum(["CPT", "DRG", "REV"]).optional(),
  code: z.string().optional().describe("Exact code this term applies to"),
  description: z.string().optional(),
  rate: z.number().optional().describe("Dollars for flat/case/per-diem terms"),
  percent: z.number().optional().describe("0-100"),
  threshold: z.number().optional().describe("Dollars, stop_loss only"),
  applies_to: z.enum(["inpatient", "outpatient", "all"]).optional(),
  effective_from: z.string().optional().describe("ISO date, escalator only"),
  source_clause: z.string().describe("Verbatim excerpt from the contract, max 400 chars"),
});

export const ContractTermsSchema = z.object({
  payer: z.string(),
  provider: z.string(),
  contract_name: z.string(),
  effective_date: z.string(),
  end_date: z.string().optional(),
  terms: z.array(TermSchema),
  admin: z.object({
    timely_filing_days: z.number().optional(),
    appeal_window_days: z.number().optional(),
    notes: z.string().optional(),
  }),
});

export type Term = z.infer<typeof TermSchema>;
export type ContractTerms = z.infer<typeof ContractTermsSchema>;
export type CodeType = "CPT" | "DRG" | "REV";
export type Flag = "underpaid" | "overpaid" | "ok" | "no_rate_found";
export type Status = "open" | "appealed" | "recovered" | "closed";

export const STATUSES: Status[] = ["open", "appealed", "recovered", "closed"];

/** One row of the uploaded claims/835-like CSV. */
export const ClaimInputSchema = z.object({
  claim_id: z.string().min(1),
  patient_ref: z.string().default(""),
  service_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  code_type: z.enum(["CPT", "DRG", "REV"]),
  code: z.string().min(1),
  description: z.string().default(""),
  units: z.number().default(1),
  billed_charges: z.number(),
  paid_amount: z.number(),
});
export type ClaimInput = z.infer<typeof ClaimInputSchema>;

export interface ClaimRow extends ClaimInput {
  id: string;
  contract_id: string;
  expected_amount: number | null;
  variance: number | null;
  flag: Flag;
  reason: string;
  clause_ref: string | null;
  status: Status;
  created_at: string;
}

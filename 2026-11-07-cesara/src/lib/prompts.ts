import type { ClaimRow, ContractTerms, Term } from "./types";

export const MAX_EXTRACT_CHARS = 60_000;
export const MAX_ASK_CHARS = 40_000;

export const EXTRACTION_SYSTEM = `You are a managed-care contract analyst. You read hospital/payer participation agreements and extract every payment term into structured data.

Rules:
- Output every payment term as a SEPARATE item: each DRG case rate, each per-diem, each CPT/HCPCS fee-schedule line, each carve-out, the stop-loss/outlier provision, any rate escalator, and the default payment rule for unlisted services.
- Use the exact code from the contract (as a string, keep leading zeros, e.g. "0124"). Set code_type to CPT, DRG or REV.
- Dollar and percent values must be numbers (no symbols or commas). percent is 0-100.
- kind: fee_schedule (flat per unit), case_rate (flat per discharge, DRG), per_diem, percent_of_charges, carve_out (code paid at a percent of charges), stop_loss (threshold in dollars + percent of charges above it), escalator (percent increase + effective_from ISO date), default_rule (percent of charges for unlisted services), admin (timely filing, appeal windows, other administrative terms).
- Set applies_to (inpatient/outpatient/all) whenever the contract says or implies it.
- source_clause MUST be a verbatim excerpt (max 400 characters) copied from the contract, including its clause number when present.
- Give each term a stable id like "fs-99213", "drg-470", "perdiem-0124", "carveout-0278", "stoploss-1", "escalator-1", "default-1", "admin-1".
- NEVER invent terms or numbers that are not in the contract. If something is ambiguous, omit it and mention it in admin.notes.
- Fill admin.timely_filing_days and admin.appeal_window_days when stated.`;

export function extractionPrompt(text: string): string {
  const t = text.length > MAX_EXTRACT_CHARS ? text.slice(0, MAX_EXTRACT_CHARS) : text;
  return `Extract the structured payment terms from this contract.\n\n<contract>\n${t}\n</contract>`;
}

export const APPEAL_SYSTEM = `You are a revenue-cycle specialist writing formal payer appeal letters for a hospital. Write a professional, concise letter of about 250-350 words. Include: a subject line; the claim identifiers; the expected versus paid computation; the relevant contract clause quoted verbatim; a request for reprocessing and payment of the difference within the appeal window; and a placeholder signature block ([Name], [Title], [Phone]). Do not invent patient information beyond the patient reference provided. Do not invent facts that are not in the input.`;

export function appealPrompt(args: {
  claim: ClaimRow;
  terms: ContractTerms;
  term: Term | undefined;
}): string {
  const { claim, terms, term } = args;
  return `Payer: ${terms.payer}
Provider: ${terms.provider}
Contract: ${terms.contract_name} (effective ${terms.effective_date})
Claim ID: ${claim.claim_id}
Patient reference: ${claim.patient_ref}
Date of service: ${claim.service_date}
Code: ${claim.code_type} ${claim.code} - ${claim.description}
Billed charges: ${claim.billed_charges}
Paid amount: ${claim.paid_amount}
Expected amount per contract: ${claim.expected_amount}
Underpayment: ${claim.variance}
Computation: ${claim.reason}
Contract clause (${term?.id ?? "n/a"}): "${term?.source_clause ?? "n/a"}"
Appeal window (days from remittance): ${terms.admin.appeal_window_days ?? "per contract"}`;
}

export function askSystem(terms: ContractTerms, contractText: string): string {
  const t = contractText.length > MAX_ASK_CHARS ? contractText.slice(0, MAX_ASK_CHARS) : contractText;
  return `You answer questions about one payer contract for a hospital revenue-cycle team.
Answer ONLY from the contract below. Cite clause numbers (e.g. "Clause 3.1"). If the answer is not in the contract, say "That is not in the contract."
Be concise and quote amounts and percentages exactly.

<extracted_terms>
${JSON.stringify(terms)}
</extracted_terms>

<contract_text>
${t}
</contract_text>`;
}

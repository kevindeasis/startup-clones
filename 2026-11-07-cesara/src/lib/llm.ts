import { generateObject, generateText, streamText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { ContractTermsSchema, type ClaimRow, type ContractTerms, type Term } from "./types";
import { SAMPLE_TERMS } from "./sample";
import { money } from "./format";
import {
  APPEAL_SYSTEM,
  EXTRACTION_SYSTEM,
  appealPrompt,
  askSystem,
  extractionPrompt,
} from "./prompts";

export function isMock(): boolean {
  return process.env.MOCK_LLM === "1" || !process.env.ANTHROPIC_API_KEY;
}

let warned = false;
function noteMock() {
  if (!warned) {
    warned = true;
    console.warn(
      "[claimcheck] MOCK mode active (MOCK_LLM=1 or no ANTHROPIC_API_KEY): using deterministic canned LLM outputs.",
    );
  }
}

function model() {
  return anthropic(process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5");
}

// ---------------------------------------------------------------- extraction

export function postProcessTerms(terms: ContractTerms): ContractTerms {
  const seen = new Set<string>();
  const out: Term[] = [];
  for (const t of terms.terms) {
    let id = String(t.id || `${t.kind}-${out.length}`);
    if (seen.has(id)) {
      let n = 2;
      while (seen.has(`${id}-${n}`)) n++;
      id = `${id}-${n}`;
    }
    seen.add(id);
    out.push({
      ...t,
      id,
      code: t.code !== undefined && t.code !== null ? String(t.code) : undefined,
      source_clause: String(t.source_clause ?? "").slice(0, 400),
    });
  }
  return { ...terms, terms: out };
}

export async function extractTerms(text: string): Promise<ContractTerms> {
  if (isMock()) {
    noteMock();
    return structuredClone(SAMPLE_TERMS);
  }
  const { object } = await generateObject({
    model: model(),
    schema: ContractTermsSchema,
    system: EXTRACTION_SYSTEM,
    prompt: extractionPrompt(text),
  });
  return postProcessTerms(object);
}

// -------------------------------------------------------------------- appeal

export function templateAppeal(claim: ClaimRow, terms: ContractTerms, term: Term | undefined): string {
  const window = terms.admin.appeal_window_days ?? 180;
  return `Subject: Appeal for underpayment - Claim ${claim.claim_id} - ${terms.provider}

To: ${terms.payer} Provider Appeals Department
Re: Claim ${claim.claim_id} | Patient ref ${claim.patient_ref} | Date of service ${claim.service_date} | ${claim.code_type} ${claim.code} (${claim.description})
Contract: ${terms.contract_name}, effective ${terms.effective_date}

Dear Appeals Reviewer,

${terms.provider} is writing to appeal the payment on the claim referenced above, which was reimbursed below the amount required by our participation agreement.

Payment summary
- Billed charges: ${money(claim.billed_charges)}
- Amount paid per remittance: ${money(claim.paid_amount)}
- Amount due under the contract: ${money(claim.expected_amount)}
- Underpayment: ${money(claim.variance)}

How the contract amount is calculated
${claim.reason}

Relevant contract provision (${term?.id ?? "contract"})
"${term?.source_clause ?? "See contract."}"

Based on the provision above, we request that ${terms.payer} reprocess this claim and remit the additional ${money(claim.variance)}, together with any interest owed under applicable prompt-pay requirements. This appeal is submitted within the ${window}-day appeal window of the remittance advice. The contract excerpt and the 835 remittance are attached for your reference.

Please contact us if any additional documentation is needed.

Sincerely,

[Name]
[Title]
${terms.provider}
[Phone] | [Email]`;
}

export async function draftAppeal(claim: ClaimRow, terms: ContractTerms): Promise<string> {
  const term = terms.terms.find((t) => t.id === claim.clause_ref);
  if (isMock()) {
    noteMock();
    return templateAppeal(claim, terms, term);
  }
  const { text } = await generateText({
    model: model(),
    system: APPEAL_SYSTEM,
    prompt: appealPrompt({ claim, terms, term }),
  });
  return text;
}

// ----------------------------------------------------------------------- ask

const STOP = new Set(
  "a an the of to is are what who how do does for in on and or by with at be as it its this that from my our we you i can any if than then".split(" "),
);
const words = (s: string) =>
  s.toLowerCase().split(/[^a-z0-9$%.]+/).map((w) => w.replace(/^\.+|\.+$/g, "")).filter((w) => w && !STOP.has(w));

export function mockAnswer(question: string, terms: ContractTerms): string {
  const q = question.toLowerCase();
  const find = (kind: Term["kind"]) => terms.terms.find((t) => t.kind === kind);
  const quote = (t: Term | undefined) => (t ? `\n\nClause: "${t.source_clause}"` : "");

  if (/stop.?loss|outlier/.test(q)) {
    const t = find("stop_loss");
    if (t)
      return `The stop-loss (outlier) threshold is ${money(t.threshold).replace(".00", "")} in billed charges. Above it, the payer pays the case rate plus ${t.percent}% of billed charges above ${money(t.threshold).replace(".00", "")}.${quote(t)}`;
  }
  if (/escalat|increase|raise|cola/.test(q)) {
    const t = find("escalator");
    if (t) return `All rates increase ${t.percent}% for dates of service on or after ${t.effective_from}.${quote(t)}`;
  }
  if (/carve|implant/.test(q)) {
    const t = find("carve_out");
    if (t) return `${t.description ?? "Carve-out"}: revenue code ${t.code} is paid at ${t.percent}% of billed charges.${quote(t)}`;
  }
  if (/per.?diem|behavioral/.test(q)) {
    const t = find("per_diem");
    if (t) return `${t.description ?? "Per diem"}: revenue code ${t.code} is paid ${money(t.rate)} per covered day.${quote(t)}`;
  }
  if (/default|not listed|unlisted|otherwise/.test(q)) {
    const t = find("default_rule");
    if (t) return `Covered services not otherwise listed are paid at ${t.percent}% of billed charges.${quote(t)}`;
  }
  if (/timely|filing/.test(q) && terms.admin.timely_filing_days)
    return `Claims must be submitted within ${terms.admin.timely_filing_days} days of the date of service.${terms.admin.notes ? `\n\nClause: "${terms.admin.notes}"` : ""}`;
  if (/appeal/.test(q) && terms.admin.appeal_window_days) {
    const t = terms.terms.find((x) => x.kind === "admin");
    return `Underpayments may be appealed within ${terms.admin.appeal_window_days} days of the remittance advice date.${quote(t)}`;
  }

  const codes = q.match(/\b\d{3,5}\b/g) ?? [];
  for (const c of codes) {
    const t = terms.terms.find((x) => x.code === c);
    if (t) {
      const amt = t.rate !== undefined ? money(t.rate) : `${t.percent}% of billed charges`;
      return `${t.code_type ?? ""} ${t.code} (${t.description ?? t.kind}) is paid ${amt}${t.kind === "per_diem" ? " per day" : t.kind === "case_rate" ? " per discharge" : ""}.${quote(t)}`;
    }
  }

  const qw = new Set(words(question));
  let best: { t: Term; score: number } | undefined;
  for (const t of terms.terms) {
    const tw = new Set(words(`${t.description ?? ""} ${t.source_clause}`));
    let score = 0;
    qw.forEach((w) => tw.has(w) && score++);
    if (!best || score > best.score) best = { t, score };
  }
  if (best && best.score > 0)
    return `The most relevant clause I found:\n\n"${best.t.source_clause}"`;
  return "That is not in the contract.";
}

/** Returns a Response with streamed (or, in mock mode, plain) text. */
export async function askContract(
  messages: { role: "user" | "assistant"; content: string }[],
  terms: ContractTerms,
  contractText: string,
): Promise<Response> {
  if (isMock()) {
    noteMock();
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    return new Response(mockAnswer(lastUser?.content ?? "", terms), {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  const result = streamText({
    model: model(),
    system: askSystem(terms, contractText),
    messages,
  });
  return result.toTextStreamResponse();
}

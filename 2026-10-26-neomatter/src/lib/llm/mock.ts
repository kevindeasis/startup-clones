import type { TriageOutput } from "../schemas";

export type ContextItem = { id: string; kind: "clause" | "precedent"; practiceArea: string; title: string; text: string };

export type MockInput = {
  subject: string;
  body: string;
  attachments: { name: string; text: string }[];
  requesterName: string;
  context: ContextItem[];
};

const AREA_RULES: [RegExp, TriageOutput["practice_area"]][] = [
  [/\b(nda|agreement|msa|contract)\b/i, "commercial"],
  [/\b(employee|offer letter|termination)\b/i, "employment"],
  [/\b(board|resolution|stock)\b/i, "corporate"],
  [/\b(gdpr|personal data|dpa)\b/i, "privacy"],
];

const RISKY: { re: RegExp; issue: string; proposed: string; hint: RegExp }[] = [
  { re: /unlimited liability/i, issue: "Uncapped liability exceeds our standard position.", proposed: "Each party's aggregate liability is capped at the fees paid in the 12 months preceding the claim.", hint: /liab/i },
  { re: /auto-?renew/i, issue: "Automatic renewal without a notice window.", proposed: "The Agreement renews only by written agreement; otherwise either party may give 60 days' notice of non-renewal.", hint: /renew/i },
  { re: /perpetual/i, issue: "Perpetual obligations; confidentiality should be time-limited.", proposed: "Confidentiality obligations survive for three (3) years after termination.", hint: /confiden|term/i },
  { re: /exclusive/i, issue: "Exclusivity restricts the business.", proposed: "Delete exclusivity, or limit it to a named product for 12 months.", hint: /exclusiv|term/i },
  { re: /non-?compete/i, issue: "Non-compete is restricted by our employment policy.", proposed: "Replace with a non-solicitation covenant of 12 months.", hint: /compete/i },
  { re: /indemnif/i, issue: "Broad indemnity; limit to third-party claims.", proposed: "Indemnity is limited to third-party claims arising from breach, subject to the liability cap.", hint: /indemn/i },
];

function sentenceAround(text: string, re: RegExp): string {
  const m = re.exec(text);
  if (!m) return "";
  const start = Math.max(0, text.lastIndexOf(".", m.index) + 1);
  let end = text.indexOf(".", m.index + m[0].length);
  if (end < 0) end = text.length;
  return text.slice(start, Math.min(end + 1, start + 240)).trim();
}

export function mockTriage(input: MockInput): TriageOutput {
  const attachmentText = input.attachments.map((a) => a.text).join("\n");
  const all = `${input.subject}\n${input.body}\n${attachmentText}`;
  const area = AREA_RULES.find(([re]) => re.test(all))?.[1] ?? "general";
  const urgent = /(?<!not )\b(urgent|today|asap|eod)\b/i.test(all);
  const urgency: TriageOutput["urgency"] = urgent ? "P1" : "P2";

  const sameArea = input.context.filter((c) => c.practiceArea === area);
  const clauses = input.context.filter((c) => c.kind === "clause");
  const pool = sameArea.length ? sameArea : input.context;

  // Redline: one row per risky phrase found in the attachment, citing the best matching clause.
  const redline: TriageOutput["redline"] = [];
  for (const r of RISKY) {
    if (!r.re.test(attachmentText)) continue;
    const cite = clauses.find((c) => r.hint.test(c.title + " " + c.text)) ?? clauses[0];
    redline.push({
      clause_quote: sentenceAround(attachmentText, r.re) || r.re.source,
      issue: r.issue,
      proposed_language: r.proposed,
      citations: cite ? [cite.id] : [],
    });
  }

  const cited = new Set<string>(redline.flatMap((r) => r.citations));
  for (const c of pool.slice(0, 2)) cited.add(c.id);
  const topClause = pool.find((c) => c.kind === "clause");
  const topPrecedent = input.context.find((c) => c.kind === "precedent");

  const decisionRequired = redline.length > 0 || /\b(approve|approval|sign)\b/i.test(all);
  const options = decisionRequired
    ? [
        { label: "Sign with redlines", rationale: "Send proposed language and sign once the counterparty accepts.", risk: "Low; may take a negotiation round.", citations: topClause ? [topClause.id] : [] },
        { label: "Sign as-is", rationale: "Fastest path for the business.", risk: "High; leaves risky terms in place.", citations: topClause ? [topClause.id] : [] },
        { label: "Decline", rationale: "Walk away if the counterparty refuses all changes.", risk: "Medium; commercial impact.", citations: topPrecedent ? [topPrecedent.id] : [] },
      ]
    : [];
  if (topPrecedent) cited.add(topPrecedent.id);

  const missing: string[] = [];
  if (!input.context.length) missing.push("No relevant playbook clause or precedent was retrieved.");
  if (area === "commercial" && !input.attachments.length) missing.push("Attach the counterparty document for review.");
  if (!/\b(by|before|deadline|due)\b/i.test(all) && !urgent) missing.push("Requested deadline.");

  const keyTerms: TriageOutput["key_terms"] = [];
  const term = /term:\s*([^.\n]+)/i.exec(all);
  if (term) keyTerms.push({ label: "Term", value: term[1].trim() });
  for (const r of RISKY) if (r.re.test(all)) keyTerms.push({ label: "Flagged phrase", value: r.re.exec(all)![0] });
  const dates: TriageOutput["dates"] = [];
  const eod = /\b(today|eod|asap)\b/i.exec(all);
  if (eod) dates.push({ label: "Needed by", date: eod[0].toUpperCase() === "TODAY" ? "today" : eod[0] });
  const iso = /\b\d{4}-\d{2}-\d{2}\b/.exec(all);
  if (iso) dates.push({ label: "Date mentioned", date: iso[0] });

  const recommended = options[0]?.label ?? "";
  const firstName = input.requesterName.split(" ")[0];
  const reply = [
    `Hi ${firstName},`,
    `Thanks for sending this over. Legal has picked it up (${area}, priority ${urgency}).`,
    redline.length
      ? `We reviewed the attached document against our playbook and found ${redline.length} point${redline.length > 1 ? "s" : ""} to change: ${redline.map((r) => r.issue.split(";")[0].replace(/\.$/, "")).join("; ")}. We will send proposed language once a lawyer has approved it.`
      : `A lawyer will review the details and come back to you.`,
    missing.length ? `To move faster, please send: ${missing.join(" ")}` : "",
    `Please do not sign or commit to anything until you hear back from us.`,
  ].filter(Boolean).join("\n\n");

  return {
    title: input.subject.slice(0, 90),
    summary: `${input.requesterName} asks about "${input.subject}". Classified as ${area}. ${redline.length ? `${redline.length} risky clause(s) were found in the attachment.` : "No attached contract text was redlined."}`,
    practice_area: area,
    urgency,
    urgency_reason: urgent ? "Request mentions an immediate deadline." : "No immediate deadline stated.",
    ask: input.body.split(/(?<=[.!?])\s/)[0]?.slice(0, 200) || input.subject,
    missing_info: missing,
    key_terms: keyTerms,
    dates,
    decision_required: decisionRequired,
    decision: { question: decisionRequired ? "How should we proceed with this document?" : "", options, recommended_label: recommended },
    redline,
    draft_reply: reply,
    citations_used: [...cited],
  };
}

export function mockClarify(missing: string[], requesterName: string): { message: string } {
  const firstName = requesterName.split(" ")[0];
  const list = missing.length ? missing.map((m) => `- ${m}`).join("\n") : "- Any additional context on the business goal and deadline";
  return { message: `Hi ${firstName},\n\nBefore legal can finish this review we need a bit more information:\n${list}\n\nThanks!` };
}

// Deterministic mock "LLM": keyword-based hypotheses, scripted interviewer, keyword scoring.
import type { Stance } from "./confidence";

export interface EvidenceRow { id: number; kind: string; text: string; account_id: number | null }
export interface HypothesisLite { id: number; statement: string; confidence: number }
export interface Msg { role: "assistant" | "user"; content: string }

interface Theme {
  key: string;
  statement: string;
  rationale: string;
  match: RegExp;        // matches evidence text (tickets/calls)
  detect: RegExp;       // identifies the theme in a hypothesis statement
  question: string;     // open-ended, non-leading interview question
  answer: RegExp;       // matches respondent answers when scoring
}

export const THEMES: Theme[] = [
  { key: "pricing", statement: "Pricing is not matched to the value customers perceive, so budget-holders cancel.",
    rationale: "Tickets and calls mention cost, invoices, or cheaper alternatives.",
    match: /pric|expens|cost|budget|invoice|billing|discount|cheaper/i, detect: /pric/i,
    question: "How do you think about what you pay for the product compared with what you get out of it?",
    answer: /pric|expens|cost|budget|invoice|billing|discount|cheap|afford|pay/i },
  { key: "onboarding", statement: "Poor onboarding leaves teams stuck before they reach their first success.",
    rationale: "Customers describe confusing setup, missing training or unclear docs.",
    match: /onboard|setup|set up|confus|getting started|training|docs|tutorial/i, detect: /onboarding/i,
    question: "Can you walk me through what the first few weeks of getting started looked like for your team?",
    answer: /onboard|setup|set up|confus|getting started|training|docs|tutorial|learn|start/i },
  { key: "reliability", statement: "Reliability and performance problems erode trust in the product.",
    rationale: "Tickets mention bugs, slowness, outages or errors.",
    match: /\bbugs?\b|slow|outage|crash|\bdown\b|error|broken|latency|downtime/i, detect: /reliab/i,
    question: "Tell me about a time the product didn't behave the way you expected. What happened next?",
    answer: /\bbugs?\b|slow|outage|crash|\bdown\b|error|broken|latency|downtime|reliab|stable|fail/i },
  { key: "features", statement: "Missing features or integrations block customers from their core workflow.",
    rationale: "Customers request exports, SSO, APIs or other capabilities.",
    match: /missing|feature|export|\bapi\b|\bsso\b|wish|lack|integration|workaround/i, detect: /feature/i,
    question: "Is there anything you needed to do in your work that the product couldn't help with?",
    answer: /missing|feature|export|\bapi\b|\bsso\b|wish|lack|integrat|workaround|couldn't|can't/i },
  { key: "support", statement: "Slow or unhelpful support responses push frustrated customers away.",
    rationale: "Customers report waiting long for replies or escalations ignored.",
    match: /support|response time|waiting|ignored|escalat|no reply|unanswered/i, detect: /support/i,
    question: "When you ran into trouble, how did getting help from us go?",
    answer: /support|response|waiting|ignored|escalat|repl(y|ied)|agent/i },
  { key: "champion", statement: "Loss of the internal champion leaves accounts without an advocate.",
    rationale: "Notes mention the sponsor leaving, reorganizations or new managers.",
    match: /left the company|leaving|new manager|champion|turnover|reorg|replaced|laid off|new owner/i, detect: /champion/i,
    question: "Who on your team drove the use of the product, and how has that changed over time?",
    answer: /left|leaving|manager|champion|turnover|reorg|replaced|laid off|owner|team changed|sponsor/i },
  { key: "engagement", statement: "Low product engagement precedes churn: accounts stop logging in well before they cancel.",
    rationale: "Usage rows show few logins or long inactivity for churned or at-risk accounts.",
    match: /^$/ /* usage handled separately */, detect: /engagement/i,
    question: "How often does your team actually use the product day to day, and what gets in the way?",
    answer: /rarely|stopped using|no time|busy|log ?in|usage|adopt|didn't use|don't use|stopped|habit/i },
];

export function themeOf(statement: string): Theme | undefined {
  return THEMES.find((t) => t.detect.test(statement));
}

function lowEngagement(text: string): boolean {
  const l = /logins_30d=(\d+)/.exec(text);
  const d = /last_active_days=(\d+)/.exec(text);
  return (!!l && Number(l[1]) < 5) || (!!d && Number(d[1]) > 30);
}

export function mockHypotheses(evidence: EvidenceRow[]) {
  const scored = THEMES.map((t, idx) => {
    const ids = evidence
      .filter((e) => (t.key === "engagement" ? e.kind === "usage" && lowEngagement(e.text) : e.kind !== "usage" && t.match.test(e.text)))
      .map((e) => e.id);
    return { t, ids, idx };
  });
  scored.sort((a, b) => b.ids.length - a.ids.length || a.idx - b.idx);
  const total = Math.max(1, scored.reduce((s, x) => s + x.ids.length, 0));
  const top = scored.slice(0, Math.min(5, Math.max(3, scored.filter((s) => s.ids.length > 0).length)));
  return {
    hypotheses: top.map((s) => ({
      statement: s.t.statement,
      rationale: `${s.t.rationale} (${s.ids.length} matching evidence rows)`,
      evidenceIds: s.ids.slice(0, 8),
      confidence: Math.round(Math.min(0.9, 0.25 + 0.6 * (s.ids.length / total)) * 100) / 100,
    })).sort((a, b) => b.confidence - a.confidence),
  };
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

export function mockInterviewerQuestion(hyps: HypothesisLite[], messages: Msg[]): string {
  const assistant = messages.filter((m) => m.role === "assistant");
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const lastAssistant = assistant[assistant.length - 1];
  if (!lastUser) return "Thanks for joining. To start, can you tell me a bit about your role and how you use the product?";
  // short answer -> probe
  if (words(lastUser.content) < 6 && !/tell me more/i.test(lastAssistant?.content ?? "")) {
    return "Could you tell me a bit more about that? Why was that the case?";
  }
  // answer touches a hypothesis theme -> follow up on it once
  const alreadyFollowed = /^You mentioned/.test(lastAssistant?.content ?? "");
  if (!alreadyFollowed) {
    const sentence = lastUser.content.split(/(?<=[.!?])\s+/).find((s) => THEMES.some((t) => t.answer.test(s)));
    if (sentence && sentence.length > 12) {
      const snippet = sentence.length > 90 ? sentence.slice(0, 87) + "..." : sentence;
      return `You mentioned "${snippet}" - why do you think that happened, and what did you do about it?`;
    }
  }
  // otherwise target the most uncertain hypothesis not yet asked about
  const asked = assistant.map((m) => m.content);
  const ordered = [...hyps].sort((a, b) => Math.abs(a.confidence - 0.5) - Math.abs(b.confidence - 0.5));
  for (const h of ordered) {
    const t = themeOf(h.statement);
    if (t && !asked.includes(t.question)) return t.question;
  }
  return "DONE";
}

const NEG = /\b(not|no|never|didn't|wasn't|isn't|don't|doesn't|fine|great|happy|love|easy)\b/i;

export function mockScore(hyps: HypothesisLite[], userMessages: string[]) {
  const sentences = userMessages.flatMap((m) => m.split(/(?<=[.!?])\s+/)).filter((s) => s.trim());
  return {
    findings: hyps.map((h) => {
      const t = themeOf(h.statement);
      const re = t
        ? t.answer
        : new RegExp(h.statement.split(/\W+/).filter((w) => w.length > 4).join("|") || "$^", "i");
      const hit = sentences.find((s) => re.test(s));
      const stance: Stance = !hit ? "neutral" : NEG.test(hit) ? "contradicts" : "supports";
      return { hypothesisId: h.id, stance, quote: hit?.trim() ?? "" };
    }),
  };
}

export function mockSummary(userMessages: string[]): string {
  const text = userMessages.join(" ").replace(/\s+/g, " ").trim();
  return text.length > 280 ? text.slice(0, 277) + "..." : text;
}

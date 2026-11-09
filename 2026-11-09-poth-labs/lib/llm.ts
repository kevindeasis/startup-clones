import { generateObject, generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { mockHypotheses, mockInterviewerQuestion, mockScore, type EvidenceRow, type HypothesisLite, type Msg } from "./mock";

export const hypothesesSchema = z.object({
  hypotheses: z.array(z.object({
    statement: z.string(),
    rationale: z.string(),
    evidenceIds: z.array(z.number()),
    confidence: z.number().min(0).max(1),
  })).min(3).max(5),
});
export const findingsSchema = z.object({
  findings: z.array(z.object({
    hypothesisId: z.number(),
    stance: z.enum(["supports", "contradicts", "neutral"]),
    quote: z.string(),
  })),
});

export function isMock(): boolean {
  return process.env.MOCK_LLM === "1" || !process.env.ANTHROPIC_API_KEY;
}
const model = () => anthropic(process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5");

export interface DataSummary { accountCount: number; stats: string; evidence: EvidenceRow[]; }

export function buildDataSummary(accounts: { attrs: Record<string, unknown> }[], evidence: EvidenceRow[]): string {
  const nums: Record<string, number[]> = {};
  const cats: Record<string, Record<string, number>> = {};
  for (const a of accounts) {
    for (const [k, v] of Object.entries(a.attrs)) {
      const n = Number(v);
      if (v !== "" && v !== null && Number.isFinite(n)) (nums[k] ??= []).push(n);
      else if (typeof v === "string" && v.length < 30) { cats[k] ??= {}; cats[k][v] = (cats[k][v] ?? 0) + 1; }
    }
  }
  const lines = [`Accounts: ${accounts.length}`];
  for (const [k, arr] of Object.entries(nums)) lines.push(`${k}: mean=${(arr.reduce((s, x) => s + x, 0) / arr.length).toFixed(1)} min=${Math.min(...arr)} max=${Math.max(...arr)}`);
  for (const [k, c] of Object.entries(cats)) if (Object.keys(c).length <= 8) lines.push(`${k}: ${Object.entries(c).map(([a, b]) => `${a}=${b}`).join(", ")}`);
  const sample = evidence.slice(0, 60).map((e) => `[#${e.id}] (${e.kind}) ${e.text}`);
  return `${lines.join("\n")}\n\nEvidence sample (cite by id):\n${sample.join("\n")}`;
}

export async function generateHypotheses(question: string, accounts: { attrs: Record<string, unknown> }[], evidence: EvidenceRow[]) {
  if (isMock()) return mockHypotheses(evidence);
  const { object } = await generateObject({
    model: model(),
    schema: hypothesesSchema,
    system: "You are a customer research analyst. Produce 3-5 ranked hypotheses that could answer the research question, grounded in the data. Cite evidence by numeric id. Confidence is your prior belief 0-1.",
    prompt: `Research question: ${question}\n\n${buildDataSummary(accounts, evidence)}`,
  });
  const valid = new Set(evidence.map((e) => e.id));
  return {
    hypotheses: object.hypotheses
      .map((h) => ({ ...h, evidenceIds: h.evidenceIds.filter((i) => valid.has(i)) }))
      .sort((a, b) => b.confidence - a.confidence),
  };
}

export async function interviewerNext(question: string, hyps: HypothesisLite[], messages: Msg[]): Promise<string> {
  if (isMock()) return mockInterviewerQuestion(hyps, messages);
  const system = `You are an adaptive customer-research interviewer. Research question: ${question}
Current hypotheses (confidence):
${hyps.map((h) => `- ${h.statement} (${h.confidence.toFixed(2)})`).join("\n")}
Ask exactly ONE open-ended, non-leading question, targeting the most uncertain hypotheses and following up ("why?") on previous answers. Never reveal the hypotheses. If you have enough information, reply with exactly DONE.`;
  const { text } = await generateText({
    model: model(),
    system,
    messages: messages.length ? messages.map((m) => ({ role: m.role, content: m.content })) : [{ role: "user" as const, content: "(The respondent has just joined. Ask your first question.)" }],
  });
  return text.trim();
}

export async function scoreInterview(hyps: HypothesisLite[], messages: Msg[]) {
  const users = messages.filter((m) => m.role === "user").map((m) => m.content);
  if (isMock()) return mockScore(hyps, users);
  const transcript = messages.map((m) => `${m.role === "user" ? "Respondent" : "Interviewer"}: ${m.content}`).join("\n");
  const { object } = await generateObject({
    model: model(),
    schema: findingsSchema,
    system: "For each hypothesis decide whether the respondent's answers support, contradict, or are neutral to it. Include a verbatim respondent quote when stance is not neutral.",
    prompt: `Hypotheses:\n${hyps.map((h) => `id=${h.id}: ${h.statement}`).join("\n")}\n\nTranscript:\n${transcript}`,
  });
  const ids = new Set(hyps.map((h) => h.id));
  return { findings: object.findings.filter((f) => ids.has(f.hypothesisId)) };
}

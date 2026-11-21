import { generateText, Output } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import type { Answer, DocMeta, Extraction, NewsClassification, Obligor, Source } from "./types";
import { mockAnswer, mockClassifyNews, mockExtract } from "./mock";
import { tagObligors } from "./tagging";
import { bestQuote } from "./mock";

export type Mode = "live" | "mock";

export function mode(): Mode {
  return process.env.ANTHROPIC_API_KEY && process.env.LLM_MODE !== "mock" ? "live" : "mock";
}

function model() {
  const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropic(process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5");
}

const EVENT_TYPES = ["rating", "distress", "state_oversight", "leadership", "litigation", "budget", "debt_issuance", "other"] as const;
const SEVERITIES = ["low", "medium", "high"] as const;

const extractionSchema = z.object({
  rating: z.string().optional().describe("Current credit rating if stated, e.g. Baa2 or BBB+"),
  outstandingDebtUsd: z.number().optional(),
  metrics: z.array(
    z.object({
      name: z.string().describe("e.g. Days cash on hand, Operating margin, Debt service coverage, Enrollment, Pension funded ratio"),
      value: z.number(),
      unit: z.enum(["usd", "pct", "days", "x", "count"]),
      fiscalYear: z.number().int(),
      page: z.number().int().describe("1-based page number from the [[page N]] marker"),
      quote: z.string().describe("Short verbatim quote (one line) from that page that contains the figure"),
    }),
  ),
  events: z.array(
    z.object({
      type: z.enum(EVENT_TYPES),
      severity: z.enum(SEVERITIES),
      headline: z.string(),
      summary: z.string(),
      dollarAmount: z.number().optional(),
      date: z.string().optional().describe("ISO date if known"),
      page: z.number().int(),
      quote: z.string(),
    }),
  ),
});

const classifySchema = z.object({
  creditRelevant: z.boolean(),
  obligorIds: z.array(z.string()),
  eventType: z.enum(EVENT_TYPES),
  severity: z.enum(SEVERITIES),
  summary: z.string().describe("Exactly two sentences"),
  dollarAmounts: z.array(z.number()),
});

const WINDOW_CHARS = 60_000;

function windows(pages: string[]): { offset: number; pages: string[] }[] {
  const out: { offset: number; pages: string[] }[] = [];
  let cur: string[] = [];
  let len = 0;
  let offset = 0;
  pages.forEach((p, i) => {
    if (cur.length && len + p.length > WINDOW_CHARS) {
      out.push({ offset, pages: cur });
      cur = [];
      len = 0;
      offset = i;
    }
    cur.push(p);
    len += p.length + 20;
  });
  if (cur.length) out.push({ offset, pages: cur });
  return out;
}

export async function extractFromDocument(pages: string[], meta: DocMeta, obligor: Pick<Obligor, "name" | "sector" | "state">): Promise<Extraction> {
  if (mode() === "mock") return mockExtract(pages, meta);
  const merged: Extraction = { metrics: [], events: [] };
  for (const w of windows(pages)) {
    const body = w.pages.map((p, i) => `\n\n[[page ${w.offset + i + 1}]]\n\n${p}`).join("");
    const { output } = await generateText({
      model: model(),
      output: Output.object({ schema: extractionSchema }),
      system:
        "You extract credit-research facts from municipal bond disclosure documents. Only report figures and events stated in the text. " +
        "Every metric and event needs the page number (from the [[page N]] markers) and a short verbatim quote. " +
        "Flag rating actions, covenant issues, distress, state oversight, leadership changes, litigation, budget deficits and debt issuance.",
      prompt: `Obligor: ${obligor.name} (${obligor.sector}, ${obligor.state}). Document: ${meta.title} (${meta.type}${meta.fiscalYear ? `, FY${meta.fiscalYear}` : ""}).\n${body}`,
    });
    merged.metrics.push(...output.metrics);
    merged.events.push(...output.events);
    merged.rating = output.rating ?? merged.rating;
    merged.outstandingDebtUsd = output.outstandingDebtUsd ?? merged.outstandingDebtUsd;
  }
  return merged;
}

export async function classifyNews(
  item: { title: string; text: string; source?: string },
  obligors: Pick<Obligor, "id" | "name" | "aliases" | "state" | "sector">[],
): Promise<NewsClassification> {
  const base = mockClassifyNews(item, obligors); // deterministic tagging is always unioned in
  if (mode() === "mock") return base;
  const list = obligors.map((o) => `${o.id} | ${o.name} | aliases: ${o.aliases.join(", ")} | ${o.state} | ${o.sector}`).join("\n");
  const { output } = await generateText({
    model: model(),
    output: Output.object({ schema: classifySchema }),
    system:
      "You triage local news for a municipal bond credit team. creditRelevant is true only if the story could matter to the credit of a listed obligor " +
      "(ratings, distress, state oversight, leadership change, litigation, budget stress, debt issuance). Use obligor ids exactly as listed.",
    prompt: `Obligors:\n${list}\n\nArticle title: ${item.title}\nSource: ${item.source ?? "unknown"}\n\n${item.text.slice(0, 12000)}`,
  });
  const ids = Array.from(new Set([...output.obligorIds.filter((id) => obligors.some((o) => o.id === id)), ...tagObligors(`${item.title}. ${item.text}`, obligors)]));
  return { ...output, obligorIds: ids };
}

export async function answerQuestion(question: string, sources: Source[], obligorName?: string): Promise<Answer> {
  if (mode() === "mock" || sources.length === 0) return mockAnswer(question, sources, obligorName);
  const numbered = sources.map((s) => `[${s.n}] ${s.docTitle}, page ${s.page}:\n${s.text}`).join("\n\n");
  const { text } = await generateText({
    model: model(),
    system:
      "You are a municipal credit research analyst. Answer in at most 200 words using ONLY the numbered sources. " +
      "Never state facts that are not in the sources. After each sentence that uses a source, add its marker like [2]. " +
      "If the sources do not answer the question, say so.",
    prompt: `Question${obligorName ? ` about ${obligorName}` : ""}: ${question}\n\nSources:\n${numbered}`,
  });
  const used = Array.from(new Set(Array.from(text.matchAll(/\[(\d+)\]/g)).map((m) => Number(m[1]))));
  const citations = used
    .map((n) => sources.find((s) => s.n === n))
    .filter((s): s is Source => !!s)
    .map((s) => ({ n: s.n, docId: s.docId, docTitle: s.docTitle, page: s.page, quote: bestQuote(s.text, question) }));
  return { answer: text, citations };
}

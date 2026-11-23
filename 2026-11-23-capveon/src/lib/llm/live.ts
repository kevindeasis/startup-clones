import { anthropic } from "@ai-sdk/anthropic";
import { generateText, Output } from "ai";
import type { z } from "zod";
import {
  answerSchema,
  changesOutputSchema,
  extractionOutputSchema,
  letterSchema,
  rationaleSchema,
  requirementsOutputSchema,
  suggestedTasksSchema,
} from "../schemas";
import type { LLM } from "./types";
import {
  SYSTEM_ANSWER,
  SYSTEM_CHANGES,
  SYSTEM_DRAFT,
  SYSTEM_EXTRACT,
  SYSTEM_RATIONALE,
  SYSTEM_REQUIREMENTS,
  SYSTEM_TASKS,
} from "./prompts";

export function modelId(): string {
  return process.env.PREBID_MODEL || "claude-sonnet-5-5";
}

async function generate<S extends z.ZodType>(schema: S, system: string, prompt: string): Promise<z.infer<S>> {
  const result = await generateText({
    model: anthropic(modelId()),
    system,
    prompt,
    output: Output.object({ schema }),
    maxRetries: 2,
  });
  return result.output as z.infer<S>;
}

const docLine = (d: { title: string; kind: string; agencyName: string; date: string }) =>
  `Document: "${d.title}" (${d.kind}) from ${d.agencyName}, dated ${d.date}.`;

export const liveLLM: LLM = {
  mode: "live",
  get model() {
    return modelId();
  },
  async extractSignals({ page, text, doc }) {
    const out = await generate(extractionOutputSchema, SYSTEM_EXTRACT, `${docLine(doc)}\nPage ${page}:\n"""\n${text}\n"""`);
    return out.signals;
  },
  async writeFitRationale({ profile, title, category, score, breakdown, matchedKeywords }) {
    const out = await generate(
      rationaleSchema,
      SYSTEM_RATIONALE,
      `Supplier: ${profile.name} - ${profile.description}\nProject: ${title} (${category})\nFit score ${score}/100; breakdown ${JSON.stringify(breakdown)} (category max 40, keywords max 30, region max 15, value max 15). Matched keywords: ${matchedKeywords.join(", ") || "none"}.`,
    );
    return out.rationale;
  },
  async extractRequirements({ page, text, doc }) {
    const out = await generate(requirementsOutputSchema, SYSTEM_REQUIREMENTS, `${docLine(doc)}\nPage ${page}:\n"""\n${text}\n"""`);
    return out.requirements;
  },
  async answerQuestion({ question, chunks }) {
    const ctx = chunks.map((c, i) => `[${i + 1}] ${c.docTitle}, page ${c.page}:\n${c.text}`).join("\n\n");
    const out = await generate(answerSchema, SYSTEM_ANSWER, `Excerpts:\n${ctx}\n\nQuestion: ${question}`);
    const citations = out.citations.map((c) => ({
      ...c,
      documentId: chunks.find((k) => k.page === c.page)?.documentId,
    }));
    return { answer: out.answer, citations };
  },
  async suggestTasks({ pursuitTitle, requirements }) {
    const list = requirements.map((r) => `- (p.${r.page}, ${r.kind}, meets: ${r.meetsProfile}) ${r.text}`).join("\n");
    const out = await generate(suggestedTasksSchema, SYSTEM_TASKS, `Bid: ${pursuitTitle}\nRequirements:\n${list}`);
    return out.tasks.map((t) => ({ title: t.title, page: t.page ?? undefined }));
  },
  async draftLetter({ profile, agencyName, pursuitTitle, requirements }) {
    const out = await generate(
      letterSchema,
      SYSTEM_DRAFT,
      `Company profile: ${JSON.stringify({ name: profile.name, description: profile.description, certifications: profile.certifications, bondingCapacity: profile.bondingCapacity, team: profile.team })}\nPast bids: ${JSON.stringify(profile.pastBids)}\nAgency: ${agencyName}\nProject: ${pursuitTitle}\nRequirements:\n${requirements.map((r) => `- (p.${r.page}, meets: ${r.meetsProfile}) ${r.text}`).join("\n")}`,
    );
    return out.letter;
  },
  async extractChanges({ page, text, doc, parentTitle }) {
    const out = await generate(
      changesOutputSchema,
      SYSTEM_CHANGES,
      `${docLine(doc)} Addendum to: ${parentTitle}.\nPage ${page}:\n"""\n${text}\n"""`,
    );
    return out.changes.map((c) => ({ ...c, before: c.before ?? undefined, after: c.after ?? undefined }));
  },
};

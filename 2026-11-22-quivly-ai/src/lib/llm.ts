import { anthropic } from "@ai-sdk/anthropic";
import { generateText, Output } from "ai";
import type { z } from "zod";
import type { Account, Action } from "./types";
import type { AccountCtx, Source } from "./context";
import { SYSTEM } from "./prompts";
import {
  answerSchema, briefSchema, explainSchema, kickoffPlanSchema, signalSchema,
  type KickoffPlan, type SignalClass,
} from "./schemas";
import { mockAnswer, mockBrief, mockClassifySignal, mockExplainAction, mockPlanKickoff } from "./mock";
import { today } from "./util";

export type Mode = "live" | "mock";
export function mode(): Mode {
  return process.env.ANTHROPIC_API_KEY && process.env.LLM_MODE !== "mock" ? "live" : "mock";
}
const model = () => anthropic(process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5");
const cheapModel = () => anthropic(process.env.ANTHROPIC_CLASSIFY_MODEL || process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5");

type Degradable<T> = T & { degraded?: boolean };

/**
 * One structured LLM call (ai v7: generateText + Output.object; generateObject is deprecated).
 * 30 s timeout; any error falls back to the deterministic mock output, flagged degraded.
 */
async function structured<T extends object>(
  schema: z.ZodType<T>, system: string, prompt: string, fallback: () => T, cheap = false,
): Promise<Degradable<T>> {
  if (mode() === "mock") return fallback();
  try {
    const res = await generateText({
      model: cheap ? cheapModel() : model(),
      system,
      prompt,
      output: Output.object({ schema }),
      abortSignal: AbortSignal.timeout(30_000),
    });
    return res.output as T;
  } catch (err) {
    console.error("[llm] falling back to mock:", err instanceof Error ? err.message : err);
    return { ...fallback(), degraded: true };
  }
}

export function planKickoff(transcript: string, account: Account, at = today()): Promise<Degradable<KickoffPlan>> {
  return structured(
    kickoffPlanSchema, SYSTEM.kickoff,
    `Account: ${account.name} (aliases: ${account.aliases.join(", ") || "none"})\nKickoff date: ${at}\n\nTranscript:\n${transcript}`,
    () => mockPlanKickoff(transcript, account, at),
  );
}

export function classifySignal(
  item: { title: string; text: string }, accounts: Pick<Account, "id" | "name" | "aliases" | "domain">[],
): Promise<Degradable<SignalClass>> {
  const list = accounts.map((a) => `${a.id}: ${a.name} (aliases: ${a.aliases.join(", ") || "none"}; domain: ${a.domain})`).join("\n");
  return structured(
    signalSchema, SYSTEM.signal, `Accounts:\n${list}\n\nItem title: ${item.title}\nItem text: ${item.text}`,
    () => mockClassifySignal(item, accounts), true,
  );
}

export function explainAction(
  action: Pick<Action, "type" | "play" | "evidence" | "title">, ctx: { account: Account },
): Promise<Degradable<z.infer<typeof explainSchema>>> {
  return structured(
    explainSchema, SYSTEM.explain,
    `Account: ${ctx.account.name}\nAction: ${action.type} / ${action.play}\nTitle: ${action.title}\nEvidence (computed by code): ${JSON.stringify(action.evidence)}`,
    () => mockExplainAction(action, ctx), true,
  );
}

export async function draftRenewalBrief(
  ctx: AccountCtx, ask: { proposedArr: number; termMonths: number; justification: string },
): Promise<{ markdown: string; degraded?: boolean }> {
  const fallback = () => ({ markdown: mockBrief(ctx, ask) });
  if (mode() === "mock") return fallback();
  const data = {
    account: ctx.account, usageLast12Weeks: ctx.usage, usageStats: ctx.stats, quotaPct: ctx.quotaPct,
    healthHistory: ctx.snapshots, openActions: ctx.actions.filter((a) => a.status === "open"),
    projects: ctx.projects, signals: ctx.signals, tickets: ctx.tickets, invoices: ctx.invoices, notes: ctx.notes,
    renewalAsk: ask,
  };
  const res = await structured(briefSchema, SYSTEM.brief, `Account data (JSON):\n${JSON.stringify(data)}`, fallback);
  const headings = ["## Health trend", "## Usage story", "## Open risks", "## Expansion paths", "## Renewal ask", "## Talking points"];
  if (headings.every((h) => res.markdown.includes(h))) return res;
  return { ...fallback(), degraded: true };
}

export async function answerQuestion(
  question: string, sources: Source[], account: Account,
): Promise<{ answer: string; degraded?: boolean }> {
  const fallback = () => ({ answer: mockAnswer(question, sources) });
  if (mode() === "mock") return fallback();
  const srcText = sources.map((s) => `[${s.n}] (${s.kind}) ${s.title}: ${s.text}`).join("\n");
  return structured(answerSchema, SYSTEM.answer, `Account: ${account.name}\nQuestion: ${question}\n\nSources:\n${srcText}`, fallback);
}

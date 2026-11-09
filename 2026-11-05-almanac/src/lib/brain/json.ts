import { generateText } from "ai";
import type { z } from "zod";
import { getModel } from "./llm";

export type Usage = { inputTokens: number; outputTokens: number };
export const newUsage = (): Usage => ({ inputTokens: 0, outputTokens: 0 });

export function parseJsonLoose(text: string): unknown {
  const t = text.replace(/```(?:json)?/g, "").trim();
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("no JSON object found in output");
  return JSON.parse(t.slice(a, b + 1));
}

/** One generateText call returning text; adds token usage to the tracker. */
export async function callText(system: string, prompt: string, usage?: Usage): Promise<string> {
  const { model } = getModel();
  const res = await generateText({ model, system, prompt });
  if (usage) {
    usage.inputTokens += res.usage?.inputTokens ?? 0;
    usage.outputTokens += res.usage?.outputTokens ?? 0;
  }
  return res.text;
}

/** generateText + zod validation; on failure retry once with the error appended. */
export async function callJson<T>(
  system: string,
  prompt: string,
  schema: z.ZodType<T>,
  usage?: Usage,
  post?: (v: T, attempt: number) => T,
): Promise<T> {
  let err = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const p = err ? `${prompt}\n\nYour previous output was invalid: ${err}\nReturn corrected JSON only.` : prompt;
    const text = await callText(system, p, usage);
    try {
      const parsed = schema.parse(parseJsonLoose(text));
      return post ? post(parsed, attempt) : parsed;
    } catch (e) {
      err = e instanceof Error ? e.message.slice(0, 500) : String(e);
    }
  }
  throw new Error(`LLM returned invalid JSON twice: ${err}`);
}

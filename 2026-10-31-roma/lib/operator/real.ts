import { generateText, tool, stepCountIs } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import * as ops from "../ops";
import { todayISO, weekdayName } from "../dates";
import { type Tools } from "./tools";

export function buildSystemPrompt(itemId?: string): string {
  const ctx = ops.getContext();
  const lists = ctx.lists.map((l) => `- ${l.id}: ${l.name} (${l.kind})${l.fields.length ? " fields: " + l.fields.map((f) => f.name).join(", ") : ""}`).join("\n");
  const relevant = [...ctx.overdue, ...ctx.dueToday].slice(0, 20)
    .map((i) => `- ${i.id}: ${i.title} [due ${i.dueDate}] list=${i.listId}`).join("\n") || "(none)";
  let scope = "";
  if (itemId) {
    const it = ops.getItem(itemId);
    if (it) scope = `\n\nSCOPE: You are working on this one item. Prefer update_items on it.\n${JSON.stringify(it)}\nYou may use web_search to research it and update its body with drafts or rewrites.`;
  }
  return `You are Roma's operator, the engine of a to-do list that does itself.
Today is ${todayISO()} (${weekdayName()}).

Lists:
${lists}

Due today / overdue:
${relevant}

Rules:
- A to-do becomes one or more tasks with a cleaned-up, verb-first title (create_items). Default list is Tasks unless another is named; use Notes for notes.
- A question gets an answer (use web_search for current information). Save nothing.
- A passing thought gets a short reply. Save nothing.
- A due date is a day (YYYY-MM-DD, resolved relative to today) unless a time is stated; a stated time also sets dueTime (HH:MM).
- Low-risk reversible changes (create/edit/check off/move) you do directly.
- Never delete, bulk-change, or send anything without approval: use delete_items / send_email, which create approval cards. Tell the user it is awaiting approval.
- Be brief. After acting, summarize what you did in one or two sentences.${scope}`;
}

export async function realOperator(message: string, tools: Tools, itemId?: string, history: { role: "user" | "assistant"; content: string }[] = []): Promise<string> {
  const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = anthropic(process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5");
  const aiTools = Object.fromEntries(
    Object.entries(tools).map(([name, t]) => [
      name,
      tool({
        description: t.description,
        inputSchema: t.schema,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        execute: async (input: any) => (t.run as (i: unknown) => Promise<unknown>)(input) as Promise<any>,
      }),
    ]),
  );
  const result = await generateText({
    model,
    system: buildSystemPrompt(itemId),
    messages: [...history.slice(-10), { role: "user" as const, content: message }],
    tools: aiTools,
    stopWhen: stepCountIs(6),
  });
  return result.text || "Done.";
}

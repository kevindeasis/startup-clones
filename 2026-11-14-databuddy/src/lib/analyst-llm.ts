import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { getModel } from "./llm";
import { runReadOnlySql, type QueryResult } from "./sql-guard";
import { AnalystAnswerSchema, type AnalystAnswer } from "./types";

export const SCHEMA_DOC = `Table events (one row per tracked event):
  id INTEGER, site_id TEXT, ts TEXT (ISO-8601 UTC, e.g. 2026-11-14T10:00:00.000Z),
  type TEXT ('pageview' | 'event' (custom event, see name) | 'error' (JS error, name = message) | 'vital' (Web Vital, name = LCP, value in ms)),
  name TEXT, path TEXT, referrer TEXT, referrer_host TEXT ('' when direct), utm_source/utm_medium/utm_campaign TEXT,
  country TEXT, browser TEXT, os TEXT, device TEXT ('desktop'|'mobile'|'tablet'), screen_w INTEGER,
  visitor_id TEXT (cookieless, rotates daily), session_id TEXT, props TEXT (JSON), value REAL.
  Only the first pageview of a session carries referrer_host / UTM values; join through session_id to attribute later events.
Tables sites(id, name, domain, created_at), funnels(id, site_id, name, steps), goals(id, site_id, name, kind, target) also exist.`;

export function systemPrompt(siteId: string, now: Date): string {
  return `You are Bunny, the AI data analyst of Hutch, a cookieless web analytics tool. You answer questions about ONE site by querying its SQLite database through the run_sql tool.

Current date/time (UTC): ${now.toISOString()}
Site id: ${siteId} (it is bound to the :site parameter; never type it yourself)

${SCHEMA_DOC}

Rules:
- SELECT (or WITH ... SELECT) only, a single statement.
- Always filter with \`site_id = :site\` (also inside CTEs and subqueries).
- Group by day with date(ts) or by hour with strftime('%Y-%m-%d %H:00', ts). Prefer per-day series for trends.
- LIMIT 200 at most. No personal data; visitor_id is anonymous and should not be listed.
- If run_sql returns an error, fix the query and retry.

When done, reply with ONLY a JSON object: {"answer_md": string, "chart"?: {"type": "line"|"bar", "x": column, "y": column, "title"?: string}}.
answer_md is short Markdown quoting the numbers from the result. Only include chart when it helps; x and y must be columns of the last query.`;
}

export function parseAnswer(text: string): AnalystAnswer | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = AnalystAnswerSchema.safeParse(JSON.parse(text.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export type LlmOutcome = { answer: AnalystAnswer; last: Extract<QueryResult, { ok: true }> | null };

export async function askModel(siteId: string, question: string, now = new Date()): Promise<LlmOutcome> {
  let last: LlmOutcome["last"] = null;
  const run_sql = tool({
    description: "Run one read-only SQL query against the analytics database and get the rows back.",
    inputSchema: z.object({ sql: z.string(), purpose: z.string() }),
    execute: async ({ sql }) => {
      const res = runReadOnlySql(siteId, sql);
      if (!res.ok) return { error: res.error };
      last = res;
      return { columns: res.columns, rows: res.rows.slice(0, 50), rowCount: res.rowCount, truncated: res.truncated };
    },
  });
  const model = getModel();
  const system = systemPrompt(siteId, now);
  const first = await generateText({ model, system, prompt: question, tools: { run_sql }, stopWhen: stepCountIs(5) });
  let answer = parseAnswer(first.text);
  if (!answer) {
    const retry = await generateText({
      model,
      system,
      prompt: `Question: ${question}\n\nYour previous reply was not valid JSON for the required shape:\n${first.text}\n\nReply again with ONLY the JSON object.`,
    });
    answer = parseAnswer(retry.text);
  }
  return { answer: answer ?? { answer_md: first.text.trim() || "Bunny could not produce an answer." }, last };
}

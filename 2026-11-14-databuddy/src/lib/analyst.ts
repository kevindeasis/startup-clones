import { getDb } from "./db";
import { newId } from "./ids";
import { askModel } from "./analyst-llm";
import { isMockMode } from "./llm";
import { mockAnswer, planMock } from "./mock-analyst";
import { runReadOnlySql } from "./sql-guard";
import type { AskResult, ChartSpec } from "./types";

export async function ask(siteId: string, question: string): Promise<AskResult> {
  const result = { ...(isMockMode() ? askMock(siteId, question) : await askLlm(siteId, question)), id: newId() };
  getDb()
    .prepare("INSERT INTO questions (id, site_id, created_at, question, answer_md, sql, chart, rows, mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(result.id, siteId, new Date().toISOString(), question, result.answer_md, result.sql, JSON.stringify(result.chart), JSON.stringify({ columns: result.columns, rows: result.rows }), result.mode);
  return result;
}

function askMock(siteId: string, question: string): AskResult {
  const plan = planMock(question);
  const res = runReadOnlySql(siteId, plan.sql);
  if (!res.ok) throw new Error(`Mock plan failed the SQL guard: ${res.error}`);
  return { answer_md: mockAnswer(plan, res.rows), sql: res.sql, columns: res.columns, rows: res.rows, chart: plan.chart, mode: "mock" };
}

async function askLlm(siteId: string, question: string): Promise<AskResult> {
  const { answer, last } = await askModel(siteId, question);
  const chart: ChartSpec | null = last && answer.chart && last.columns.includes(answer.chart.x) && last.columns.includes(answer.chart.y) ? answer.chart : null;
  return { answer_md: answer.answer_md, sql: last?.sql ?? "", columns: last?.columns ?? [], rows: last?.rows ?? [], chart, mode: "llm" };
}

export function history(siteId: string): (AskResult & { id: string; created_at: string; question: string })[] {
  const rows = getDb().prepare("SELECT * FROM questions WHERE site_id = ? ORDER BY created_at DESC LIMIT 30").all(siteId) as {
    id: string; created_at: string; question: string; answer_md: string; sql: string; chart: string; rows: string; mode: "mock" | "llm";
  }[];
  return rows.map((r) => {
    const data = JSON.parse(r.rows) as { columns: string[]; rows: Record<string, unknown>[] };
    return { id: r.id, created_at: r.created_at, question: r.question, answer_md: r.answer_md, sql: r.sql, chart: JSON.parse(r.chart) as ChartSpec | null, mode: r.mode, ...data };
  });
}

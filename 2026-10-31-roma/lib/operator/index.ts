import { nanoid } from "nanoid";
import { eq, and } from "drizzle-orm";
import { getDb, schema } from "../db";
import * as ops from "../ops";
import { buildTools, newCtx } from "./tools";
import { mockOperator } from "./mock";
import { realOperator } from "./real";

export function isMock() {
  return process.env.MOCK_LLM === "1" || !process.env.ANTHROPIC_API_KEY;
}

export type OperatorResult = {
  assistantMessage: { id: string; content: string; createdItemIds: string[]; createdAt: string };
  createdItems: ReturnType<typeof ops.serializeItem>[];
  approvals: ReturnType<typeof ops.serializeApproval>[];
};

export function getHistory(itemId?: string) {
  const { messages } = schema;
  const rows = getDb().select().from(messages)
    .where(itemId ? and(eq(messages.scope, "item"), eq(messages.itemId, itemId)) : eq(messages.scope, "operator"))
    .orderBy(messages.createdAt).all();
  const approvals = ops.getApprovals();
  return rows.map((m) => {
    const ids: string[] = m.createdItemIdsJson ? JSON.parse(m.createdItemIdsJson) : [];
    return {
      id: m.id, role: m.role, content: m.content, createdAt: m.createdAt,
      createdItems: ids.map((i) => ops.getItem(i)).filter(Boolean),
      approvals: approvals.filter((a) => a.messageId === m.id),
    };
  });
}

export async function runOperator(opts: { thread?: "operator" | "item"; message: string; itemId?: string; persist?: boolean }): Promise<OperatorResult> {
  const { message, itemId } = opts;
  const scope = itemId ? "item" : "operator";
  const db = getDb();
  const ctx = newCtx();
  const tools = buildTools(ctx);
  const prior = opts.persist === false ? [] : getHistory(itemId).map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  let text: string;
  try {
    text = isMock() ? await mockOperator(message, tools, itemId) : await realOperator(message, tools, itemId, prior);
  } catch (e) {
    text = `Sorry, the operator failed: ${e instanceof Error ? e.message : String(e)}`;
  }

  const t = new Date().toISOString();
  const assistantId = nanoid(10);
  if (opts.persist !== false) {
    db.insert(schema.messages).values({ id: nanoid(10), scope, itemId: itemId ?? null, role: "user", content: message, createdItemIdsJson: null, createdAt: t }).run();
    db.insert(schema.messages).values({
      id: assistantId, scope, itemId: itemId ?? null, role: "assistant", content: text,
      createdItemIdsJson: JSON.stringify(ctx.createdItemIds), createdAt: new Date(Date.parse(t) + 1).toISOString(),
    }).run();
    for (const aid of ctx.approvalIds) db.update(schema.approvals).set({ messageId: assistantId }).where(eq(schema.approvals.id, aid)).run();
  }
  return {
    assistantMessage: { id: assistantId, content: text, createdItemIds: ctx.createdItemIds, createdAt: t },
    createdItems: ctx.createdItemIds.map((i) => ops.getItem(i)!).filter(Boolean),
    approvals: ctx.approvalIds.map((i) => ops.getApproval(i)!).filter(Boolean),
  };
}

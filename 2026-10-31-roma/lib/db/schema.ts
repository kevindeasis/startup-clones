import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const lists = sqliteTable("lists", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["tasks", "notes", "custom"] }).notNull(),
  fieldsJson: text("fields_json"),
  createdAt: text("created_at").notNull(),
});

export const items = sqliteTable("items", {
  id: text("id").primaryKey(),
  listId: text("list_id").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  kind: text("kind", { enum: ["task", "note"] }).notNull(),
  checked: integer("checked", { mode: "boolean" }).notNull().default(false),
  dueDate: text("due_date"),
  dueTime: text("due_time"),
  fieldsJson: text("fields_json"),
  deletedAt: text("deleted_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  scope: text("scope", { enum: ["operator", "item"] }).notNull(),
  itemId: text("item_id"),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  createdItemIdsJson: text("created_item_ids_json"),
  createdAt: text("created_at").notNull(),
});

export const approvals = sqliteTable("approvals", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: ["send_email", "delete_items", "bulk_update"] }).notNull(),
  payloadJson: text("payload_json").notNull(),
  status: text("status", { enum: ["pending", "approved", "rejected"] }).notNull().default("pending"),
  messageId: text("message_id"),
  createdAt: text("created_at").notNull(),
  resolvedAt: text("resolved_at"),
});

export const outbox = sqliteTable("outbox", {
  id: text("id").primaryKey(),
  to: text("to").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  sentAt: text("sent_at").notNull(),
});

export const automations = sqliteTable("automations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  instruction: text("instruction").notNull(),
  cron: text("cron").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastRunAt: text("last_run_at"),
  createdAt: text("created_at").notNull(),
});

export const automationRuns = sqliteTable("automation_runs", {
  id: text("id").primaryKey(),
  automationId: text("automation_id").notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  resultText: text("result_text"),
  createdItemIdsJson: text("created_item_ids_json"),
});

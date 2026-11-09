import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const lawyers = sqliteTable("lawyers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  practiceAreas: text("practice_areas", { mode: "json" }).$type<string[]>().notNull(),
  isDefault: integer("is_default").notNull().default(0),
});

export const requests = sqliteTable("requests", {
  id: text("id").primaryKey(),
  channel: text("channel").notNull(),
  requesterName: text("requester_name").notNull(),
  requesterEmail: text("requester_email"),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  attachments: text("attachments", { mode: "json" }).$type<{ name: string; text: string }[]>().notNull(),
  receivedAt: integer("received_at").notNull(),
});

export const matters = sqliteTable("matters", {
  id: text("id").primaryKey(),
  requestId: text("request_id").notNull().references(() => requests.id),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  practiceArea: text("practice_area").notNull(),
  urgency: text("urgency").notNull(),
  status: text("status").notNull(),
  ownerId: text("owner_id").references(() => lawyers.id),
  waitingOn: text("waiting_on"),
  brief: text("brief", { mode: "json" }).$type<import("@/lib/schemas").TriageOutput>().notNull(),
  draftReply: text("draft_reply").notNull(),
  chosenOption: text("chosen_option"),
  clarifyingMessage: text("clarifying_message"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const playbookClauses = sqliteTable("playbook_clauses", {
  id: text("id").primaryKey(),
  practiceArea: text("practice_area").notNull(),
  title: text("title").notNull(),
  standardPosition: text("standard_position").notNull(),
  fallbackPosition: text("fallback_position").notNull(),
  walkAway: text("walk_away").notNull(),
  approver: text("approver").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const precedents = sqliteTable("precedents", {
  id: text("id").primaryKey(),
  matterId: text("matter_id").notNull().references(() => matters.id),
  practiceArea: text("practice_area").notNull(),
  summary: text("summary").notNull(),
  outcome: text("outcome").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const events = sqliteTable("events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  matterId: text("matter_id").notNull(),
  type: text("type").notNull(),
  payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  createdAt: integer("created_at").notNull(),
});

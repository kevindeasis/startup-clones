import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import type { PassportConfidence, PassportFields, Verification } from "./types";

export const applications = sqliteTable("applications", {
  id: text("id").primaryKey(),
  destinationCode: text("destination_code").notNull(),
  nationality: text("nationality").notNull(),
  purpose: text("purpose").notNull(),
  departureDate: text("departure_date").notNull(),
  returnDate: text("return_date").notNull(),
  travellerCount: integer("traveller_count").notNull(),
  status: text("status").notNull().default("draft"),
  /** JSON array of { at, text } correction notes, stored as text. */
  notes: text("notes").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const travellers = sqliteTable("travellers", {
  id: text("id").primaryKey(),
  applicationId: text("application_id").notNull(),
  index: integer("traveller_index").notNull(),
  passport: text("passport", { mode: "json" }).$type<PassportFields>().notNull(),
  passportFile: text("passport_file").notNull(),
  passportConfidence: text("passport_confidence", { mode: "json" }).$type<PassportConfidence>().notNull(),
  createdAt: text("created_at").notNull(),
});

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  applicationId: text("application_id").notNull(),
  travellerId: text("traveller_id"),
  type: text("type").notNull(),
  filePath: text("file_path").notNull(),
  mimeType: text("mime_type").notNull(),
  extractedText: text("extracted_text").notNull().default(""),
  verification: text("verification", { mode: "json" }).$type<Verification>().notNull(),
  createdAt: text("created_at").notNull(),
});

export type ApplicationRow = typeof applications.$inferSelect;
export type TravellerRow = typeof travellers.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;

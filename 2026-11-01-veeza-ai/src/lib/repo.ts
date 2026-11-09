import { and, asc, eq } from "drizzle-orm";
import crypto from "node:crypto";
import { getDb } from "./db";
import { applications, documents, travellers, type ApplicationRow, type DocumentRow, type TravellerRow } from "./schema";
import type { PassportConfidence, PassportFields, Status, Verification } from "./types";

const now = () => new Date().toISOString();

export interface Note { at: string; text: string }
export function parseNotes(row: ApplicationRow): Note[] {
  try {
    const v = JSON.parse(row.notes);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export async function createApplication(input: {
  destinationCode: string; nationality: string; purpose: string;
  departureDate: string; returnDate: string; travellerCount: number;
}): Promise<ApplicationRow> {
  const db = await getDb();
  const row: ApplicationRow = {
    id: crypto.randomUUID(), ...input, status: "draft", notes: "[]", createdAt: now(), updatedAt: now(),
  };
  await db.insert(applications).values(row);
  return row;
}

export async function getApplication(id: string): Promise<ApplicationRow | undefined> {
  const db = await getDb();
  const rows = await db.select().from(applications).where(eq(applications.id, id));
  return rows[0];
}

export async function touch(id: string, patch: Partial<ApplicationRow> = {}): Promise<void> {
  const db = await getDb();
  await db.update(applications).set({ ...patch, updatedAt: now() }).where(eq(applications.id, id));
}

export async function listTravellers(applicationId: string): Promise<TravellerRow[]> {
  const db = await getDb();
  return db.select().from(travellers).where(eq(travellers.applicationId, applicationId)).orderBy(asc(travellers.index));
}

export async function getTraveller(id: string): Promise<TravellerRow | undefined> {
  const db = await getDb();
  return (await db.select().from(travellers).where(eq(travellers.id, id)))[0];
}

export async function addTraveller(input: {
  applicationId: string; index: number; passport: PassportFields;
  passportFile: string; passportConfidence: PassportConfidence;
}): Promise<TravellerRow> {
  const db = await getDb();
  const row: TravellerRow = { id: crypto.randomUUID(), ...input, createdAt: now() };
  await db.insert(travellers).values(row);
  return row;
}

export async function updateTravellerPassport(id: string, passport: PassportFields): Promise<void> {
  const db = await getDb();
  await db.update(travellers).set({ passport }).where(eq(travellers.id, id));
}

export async function listDocuments(applicationId: string): Promise<DocumentRow[]> {
  const db = await getDb();
  return db.select().from(documents).where(eq(documents.applicationId, applicationId)).orderBy(asc(documents.createdAt));
}

export async function addDocument(input: {
  applicationId: string; travellerId: string | null; type: string; filePath: string;
  mimeType: string; extractedText: string; verification: Verification;
}): Promise<DocumentRow> {
  const db = await getDb();
  // Re-uploading the same slot replaces the previous document.
  const existing = await listDocuments(input.applicationId);
  for (const d of existing) {
    if (d.type === input.type && d.travellerId === input.travellerId) {
      await db.delete(documents).where(and(eq(documents.id, d.id)));
    }
  }
  const row: DocumentRow = { id: crypto.randomUUID(), ...input, createdAt: now() };
  await db.insert(documents).values(row);
  return row;
}

export async function addNote(id: string, text: string): Promise<Note[]> {
  const app = await getApplication(id);
  if (!app) return [];
  const notes = [...parseNotes(app), { at: now(), text }];
  await touch(id, { notes: JSON.stringify(notes) });
  return notes;
}

export async function setStatus(id: string, status: Status): Promise<void> {
  await touch(id, { status });
}

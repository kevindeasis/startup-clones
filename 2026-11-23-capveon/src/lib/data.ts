import { promises as fs } from "node:fs";
import path from "node:path";
import { getById, readCollection, readProfile } from "./store";
import type { Agency, Award, Contact, Document, Profile, Signal } from "./types";

export function seedDir(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), "data/seed");
}

/** Profile from the store, falling back to the committed seed profile so the app is usable before `npm run seed`. */
export async function getProfile(): Promise<Profile> {
  const p = await readProfile<Profile>();
  if (p) return p;
  return JSON.parse(await fs.readFile(path.join(seedDir(), "profile.json"), "utf8")) as Profile;
}

export const getAgency = (id: string) => getById<Agency>("agencies", id);
export const getDocument = (id: string) => getById<Document>("documents", id);
export const getSignal = (id: string) => getById<Signal>("signals", id);
export const listAgencies = () => readCollection<Agency>("agencies");
export const listDocuments = () => readCollection<Document>("documents");
export const listSignals = () => readCollection<Signal>("signals");
export const listAwards = () => readCollection<Award>("awards");
export const listContacts = () => readCollection<Contact>("contacts");

export async function agencyMap(): Promise<Map<string, Agency>> {
  return new Map((await listAgencies()).map((a) => [a.id, a]));
}

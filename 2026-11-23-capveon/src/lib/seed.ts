import { promises as fs } from "node:fs";
import path from "node:path";
import { listAgencies, listAwards, listContacts, listDocuments, listSignals, seedDir } from "./data";
import { getMode, modelLabel } from "./llm";
import { ingestDocument } from "./pipeline";
import { resetStore, writeCollection, writeProfile } from "./store";
import type { Agency, Award, Contact, DocKind, Profile } from "./types";

interface IndexEntry {
  file: string;
  title: string;
  agency: string;
  kind: DocKind;
  date: string;
  parent?: string;
}

export async function seedAll() {
  const dir = seedDir();
  const json = async <T>(f: string) => JSON.parse(await fs.readFile(path.join(dir, f), "utf8")) as T;
  await resetStore();
  await writeProfile(await json<Profile>("profile.json"));
  const agencies = await json<Agency[]>("agencies.json");
  await writeCollection("agencies", agencies);
  await writeCollection("awards", await json<Award[]>("awards.json"));
  await writeCollection("contacts", await json<Contact[]>("contacts.json"));
  const index = await json<IndexEntry[]>("documents/index.json");
  const ids = new Map<string, string>();
  for (const e of index) {
    const agency = agencies.find((a) => a.name === e.agency);
    if (!agency) throw new Error(`Seed agency not found: ${e.agency}`);
    const text = await fs.readFile(path.join(dir, "documents", e.file), "utf8");
    const doc = await ingestDocument({
      title: e.title,
      agencyId: agency.id,
      kind: e.kind,
      date: e.date,
      text,
      parentDocumentId: e.parent ? ids.get(e.parent) : undefined,
    });
    if (doc.status === "failed") throw new Error(`Seed document failed: ${e.title}: ${doc.error}`);
    ids.set(e.title, doc.id);
  }
  return seedCounts();
}

export async function seedCounts() {
  const [agencies, documents, signals, awards, contacts] = await Promise.all([
    listAgencies(),
    listDocuments(),
    listSignals(),
    listAwards(),
    listContacts(),
  ]);
  return {
    profile: 1,
    agencies: agencies.length,
    documents: documents.length,
    signals: signals.length,
    awards: awards.length,
    contacts: contacts.length,
    mode: getMode(),
    model: modelLabel(),
  };
}

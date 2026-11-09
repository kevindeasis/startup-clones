import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";

const DDL = `
CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  destination_code TEXT NOT NULL,
  nationality TEXT NOT NULL,
  purpose TEXT NOT NULL,
  departure_date TEXT NOT NULL,
  return_date TEXT NOT NULL,
  traveller_count INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  notes TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS travellers (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL,
  traveller_index INTEGER NOT NULL,
  passport TEXT NOT NULL,
  passport_file TEXT NOT NULL,
  passport_confidence TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL,
  traveller_id TEXT,
  type TEXT NOT NULL,
  file_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  extracted_text TEXT NOT NULL DEFAULT '',
  verification TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_travellers_app ON travellers(application_id);
CREATE INDEX IF NOT EXISTS idx_documents_app ON documents(application_id);
`;

type Db = ReturnType<typeof drizzle<typeof schema>>;
const g = globalThis as unknown as { __visaDb?: Promise<Db>; __visaClient?: Client };

async function init(): Promise<Db> {
  const url = process.env.DATABASE_URL || "file:./data/visa.db";
  if (url.startsWith("file:")) {
    const file = url.slice("file:".length);
    fs.mkdirSync(path.dirname(path.resolve(/*turbopackIgnore: true*/ file)), { recursive: true });
  }
  const client = createClient({ url });
  g.__visaClient = client;
  await client.executeMultiple(DDL);
  return drizzle(client, { schema });
}

export function getDb(): Promise<Db> {
  if (!g.__visaDb) g.__visaDb = init();
  return g.__visaDb;
}

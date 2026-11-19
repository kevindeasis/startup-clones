import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Opportunity } from "./types";

type Db = { opportunities: Opportunity[] };

function dbPath(): string {
  return process.env.BROKERDESK_DB ?? path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "db.json");
}

function readDb(): Db {
  try {
    const raw = fs.readFileSync(/*turbopackIgnore: true*/ dbPath(), "utf8");
    const parsed = JSON.parse(raw) as Db;
    return { opportunities: parsed.opportunities ?? [] };
  } catch {
    return { opportunities: [] };
  }
}

function writeDb(db: Db): void {
  const p = dbPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, p);
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}

export function listOpportunities(): Opportunity[] {
  return readDb().opportunities.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getOpportunity(id: string): Opportunity | undefined {
  return readDb().opportunities.find((o) => o.id === id);
}

export function saveOpportunity(opp: Opportunity): Opportunity {
  const db = readDb();
  const i = db.opportunities.findIndex((o) => o.id === opp.id);
  if (i >= 0) db.opportunities[i] = opp;
  else db.opportunities.push(opp);
  writeDb(db);
  return opp;
}

export function updateOpportunity(id: string, fn: (o: Opportunity) => Opportunity): Opportunity | undefined {
  const cur = getOpportunity(id);
  if (!cur) return undefined;
  return saveOpportunity(fn(cur));
}

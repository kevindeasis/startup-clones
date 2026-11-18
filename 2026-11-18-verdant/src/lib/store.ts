import fs from "node:fs";
import path from "node:path";
import type { Application } from "./types";

type Db = { applications: Application[] };

function file(): string {
  return path.join(process.env.DATA_DIR ?? "./data", "db.json");
}

export function readDb(): Db {
  try {
    const raw = fs.readFileSync(file(), "utf8");
    const parsed = JSON.parse(raw) as Partial<Db>;
    return { applications: parsed.applications ?? [] };
  } catch {
    return { applications: [] };
  }
}

export function writeDb(db: Db): void {
  const f = file();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, f);
}

export function listApplications(): Application[] {
  return readDb().applications;
}

export function getApplication(id: string): Application | undefined {
  return readDb().applications.find((a) => a.id === id);
}

export function saveApplication(app: Application): Application {
  const db = readDb();
  const i = db.applications.findIndex((a) => a.id === app.id);
  const next = { ...app, updatedAt: new Date().toISOString() };
  if (i >= 0) db.applications[i] = next;
  else db.applications.push(next);
  writeDb(db);
  return next;
}

export function nextId(): string {
  const nums = readDb().applications.map((a) => Number(a.id.replace(/\D/g, "")) || 0);
  return `APP-${Math.max(1000, ...nums) + 1}`;
}

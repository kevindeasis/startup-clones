import samples from "@/data/sample-applications.json";
import { readDb, writeDb } from "@/lib/store";
import type { Application } from "@/lib/types";

export function POST() {
  const db = readDb();
  const have = new Set(db.applications.map((a) => a.id));
  for (const s of samples as unknown as Application[]) if (!have.has(s.id)) db.applications.push(s);
  writeDb(db);
  return Response.json({ count: db.applications.length, applications: db.applications });
}

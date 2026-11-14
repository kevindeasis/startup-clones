import { getDb } from "./db";
import { newId } from "./ids";
import type { Funnel, Goal, Site, Step } from "./types";

export const listSites = (): Site[] =>
  getDb().prepare("SELECT * FROM sites ORDER BY created_at DESC").all() as Site[];

export const getSite = (id: string): Site | undefined =>
  getDb().prepare("SELECT * FROM sites WHERE id = ?").get(id) as Site | undefined;

export function createSite(name: string, domain: string, id = newId()): Site {
  const site = { id, name, domain, created_at: new Date().toISOString() };
  getDb().prepare("INSERT INTO sites (id, name, domain, created_at) VALUES (@id, @name, @domain, @created_at)").run(site);
  return site;
}

export function deleteSite(id: string): void {
  const db = getDb();
  db.transaction(() => {
    for (const table of ["events", "funnels", "goals", "insights", "questions"]) {
      db.prepare(`DELETE FROM ${table} WHERE site_id = ?`).run(id);
    }
    db.prepare("DELETE FROM sites WHERE id = ?").run(id);
  })();
}

type FunnelRow = Omit<Funnel, "steps"> & { steps: string };
const toFunnel = (r: FunnelRow): Funnel => ({ ...r, steps: JSON.parse(r.steps) as Step[] });

export const listFunnels = (siteId: string): Funnel[] =>
  (getDb().prepare("SELECT * FROM funnels WHERE site_id = ? ORDER BY rowid").all(siteId) as FunnelRow[]).map(toFunnel);

export const getFunnel = (siteId: string, id: string): Funnel | undefined => {
  const row = getDb().prepare("SELECT * FROM funnels WHERE site_id = ? AND id = ?").get(siteId, id) as FunnelRow | undefined;
  return row && toFunnel(row);
};

export function createFunnel(siteId: string, name: string, steps: Step[], id = newId()): Funnel {
  getDb().prepare("INSERT INTO funnels (id, site_id, name, steps) VALUES (?, ?, ?, ?)").run(id, siteId, name, JSON.stringify(steps));
  return { id, site_id: siteId, name, steps };
}

export const deleteFunnel = (siteId: string, id: string): void => {
  getDb().prepare("DELETE FROM funnels WHERE site_id = ? AND id = ?").run(siteId, id);
};

export const listGoals = (siteId: string): Goal[] =>
  getDb().prepare("SELECT * FROM goals WHERE site_id = ? ORDER BY rowid").all(siteId) as Goal[];

export function createGoal(siteId: string, name: string, kind: Goal["kind"], target: string, id = newId()): Goal {
  getDb().prepare("INSERT INTO goals (id, site_id, name, kind, target) VALUES (?, ?, ?, ?, ?)").run(id, siteId, name, kind, target);
  return { id, site_id: siteId, name, kind, target };
}

export const deleteGoal = (siteId: string, id: string): void => {
  getDb().prepare("DELETE FROM goals WHERE site_id = ? AND id = ?").run(siteId, id);
};

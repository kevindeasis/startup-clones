import { promises as fs } from "node:fs";
import path from "node:path";
import { SiteSchema, type Site, type Version } from "./schema";
import { now, uid } from "./util";

const DIR = path.join(process.cwd(), "data", "sites");
const safe = (id: string) => /^[a-z0-9_-]+$/i.test(id);

export async function readSite(id: string): Promise<Site | null> {
  if (!safe(id)) return null;
  try {
    const raw = await fs.readFile(path.join(DIR, `${id}.json`), "utf8");
    return SiteSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function writeSite(site: Site): Promise<Site> {
  await fs.mkdir(DIR, { recursive: true });
  site.updatedAt = now();
  const file = path.join(DIR, `${site.id}.json`);
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(site, null, 2));
  await fs.rename(tmp, file);
  return site;
}

export async function listSites(): Promise<Site[]> {
  try {
    const files = await fs.readdir(DIR);
    const out: Site[] = [];
    for (const f of files.filter((f) => f.endsWith(".json"))) {
      const s = await readSite(f.slice(0, -5));
      if (s) out.push(s);
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

export async function findBySlug(slug: string): Promise<Site | null> {
  return (await listSites()).find((s) => s.slug === slug) ?? null;
}

export async function uniqueSlug(base: string): Promise<string> {
  const taken = new Set((await listSites()).map((s) => s.slug));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

/** Snapshot the given pages as a new version entry and persist. */
export async function appendVersion(site: Site, summary: string): Promise<Site> {
  const v: Version = { id: uid("v_"), createdAt: now(), summary, pages: structuredClone(site.pages) };
  site.versions.push(v);
  return writeSite(site);
}

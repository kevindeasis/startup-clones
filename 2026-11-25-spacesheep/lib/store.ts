import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { assignBlockIds, extractText } from "./html";

export type Version = { n: number; html: string; text: string; author: string; note: string; created_at: string };
export type Comment = {
  id: string; block: string | null; author: string; body: string; created_at: string; resolved: boolean;
  parent_id?: string; kind: "user" | "agent";
  meta?: { version_created: number; previous_version: number; diff: string; summary: string };
};
export type Space = {
  id: string; slug: string; title: string; visibility: "private" | "public";
  created_at: string; updated_at: string; versions: Version[]; comments: Comment[];
};

const DIR = path.join(process.cwd(), "data", "spaces");
const locks = new Map<string, Promise<unknown>>();

function ensure() { fs.mkdirSync(DIR, { recursive: true }); }
const file = (id: string) => path.join(DIR, `${id}.json`);

export function listSpaces(): Space[] {
  ensure();
  return fs.readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")) as Space)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}
export function findSpace(idOrSlug: string): Space | null {
  ensure();
  if (/^[a-z0-9-]+$/i.test(idOrSlug) && fs.existsSync(file(idOrSlug))) return JSON.parse(fs.readFileSync(file(idOrSlug), "utf8"));
  return listSpaces().find((s) => s.slug === idOrSlug) || null;
}
export function saveSpace(s: Space) { ensure(); fs.writeFileSync(file(s.id), JSON.stringify(s, null, 2)); }

/** In-process mutex per space. */
export async function withLock<T>(id: string, fn: () => Promise<T> | T): Promise<T> {
  const prev = locks.get(id) || Promise.resolve();
  const run = prev.then(fn, fn);
  locks.set(id, run.catch(() => {}));
  return run as Promise<T>;
}

export const now = () => new Date().toISOString();
export const uid = () => crypto.randomBytes(6).toString("hex");

export function slugify(t: string) {
  return t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "space";
}

export function makeVersion(space: Space, html: string, author: string, note = ""): Version {
  const withIds = assignBlockIds(html);
  const v: Version = { n: space.versions.length + 1, html: withIds, text: extractText(withIds), author, note, created_at: now() };
  space.versions.push(v);
  space.updated_at = v.created_at;
  return v;
}

export function createSpace(title: string, html: string, visibility: "private" | "public" = "private", slug?: string): Space {
  let base = slugify(slug || title);
  let s = base, i = 2;
  while (findSpace(s)) s = `${base}-${i++}`;
  const space: Space = { id: uid(), slug: s, title, visibility, created_at: now(), updated_at: now(), versions: [], comments: [] };
  makeVersion(space, html, "agent", "initial publish");
  saveSpace(space);
  return space;
}

export const currentVersion = (s: Space) => s.versions[s.versions.length - 1];
export function summary(s: Space) {
  return { id: s.id, slug: s.slug, title: s.title, visibility: s.visibility, versions: s.versions.length, created_at: s.created_at, updated_at: s.updated_at, comments: s.comments.length };
}

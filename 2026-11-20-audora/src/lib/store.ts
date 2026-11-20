import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Story, StorySummary } from "./types";

export function dataDir(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR?.trim() || "./data");
}
function storiesDir(): string {
  const d = path.join(dataDir(), "stories");
  fs.mkdirSync(d, { recursive: true });
  return d;
}
const ID_RE = /^[a-z0-9]{6,32}$/;
export const isValidId = (id: string) => ID_RE.test(id);
const fileFor = (id: string) => path.join(storiesDir(), `${id}.json`);

export function newId(): string {
  return crypto.randomBytes(5).toString("hex");
}

/** Synchronous on purpose: read-modify-write sequences are atomic within the single Node event loop. */
export function getStory(id: string): Story | null {
  if (!isValidId(id)) return null;
  try {
    return JSON.parse(fs.readFileSync(fileFor(id), "utf8")) as Story;
  } catch {
    return null;
  }
}

export function saveStory(story: Story): Story {
  if (!isValidId(story.id)) throw new Error("invalid story id");
  story.updatedAt = new Date().toISOString();
  const file = fileFor(story.id);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(story, null, 2));
  fs.renameSync(tmp, file);
  return story;
}

export function deleteStory(id: string): boolean {
  if (!isValidId(id)) return false;
  try {
    fs.unlinkSync(fileFor(id));
    return true;
  } catch {
    return false;
  }
}

export function summarize(s: Story): StorySummary {
  return {
    id: s.id, title: s.title, sourceKind: s.source.kind, status: s.status, wordCount: s.wordCount,
    castSize: s.cast.length, chunksDone: s.chunksDone, chunksTotal: s.chunksTotal, mode: s.mode,
    createdAt: s.createdAt, updatedAt: s.updatedAt,
  };
}

export function listStories(): StorySummary[] {
  const dir = storiesDir();
  const out: StorySummary[] = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const s = getStory(f.slice(0, -5));
    if (s) out.push(summarize(s));
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

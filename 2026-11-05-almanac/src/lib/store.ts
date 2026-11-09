import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type { Chat, CompileRun, Source, SourceKind, Task, WikiKind, WikiPage } from "./types";

export function dataDir(): string {
  return path.resolve(process.cwd(), process.env.DATA_DIR || "./data");
}
const sub = (...p: string[]) => path.join(dataDir(), ...p);
function ensure(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}
function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}
function writeJson(file: string, value: unknown) {
  ensure(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

/* ---------- sources ---------- */
export function listSources(): Source[] {
  const dir = sub("sources");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => readJson<Source | null>(path.join(dir, f), null))
    .filter((s): s is Source => !!s)
    .sort((a, b) => a.id - b.id);
}
export function getSource(id: number): Source | null {
  return readJson<Source | null>(sub("sources", `${id}.json`), null);
}
export function saveSource(s: Source) {
  writeJson(sub("sources", `${s.id}.json`), s);
}
export function addSource(input: { title: string; kind: SourceKind; text: string }): Source {
  const id = listSources().reduce((m, s) => Math.max(m, s.id), 0) + 1;
  const s: Source = { id, title: input.title, kind: input.kind, text: input.text, createdAt: new Date().toISOString() };
  saveSource(s);
  return s;
}
export function deleteSource(id: number): boolean {
  const f = sub("sources", `${id}.json`);
  if (!fs.existsSync(f)) return false;
  fs.unlinkSync(f);
  return true;
}

/* ---------- wiki ---------- */
export function safeWikiPath(p: string): string {
  const norm = path.posix.normalize(p.replace(/\\/g, "/"));
  if (norm.startsWith("..") || norm.startsWith("/") || !norm.endsWith(".md") || norm.includes("\0")) {
    throw new Error("invalid wiki path");
  }
  return norm;
}
export function kindFromPath(p: string): WikiKind {
  if (p === "overview.md") return "overview";
  if (p === "decisions.md") return "decisions";
  if (p === "open-loops.md") return "open-loops";
  if (p === "timeline.md") return "timeline";
  if (p === "glossary.md") return "glossary";
  if (p.startsWith("people/")) return "person";
  return "project";
}
export function readPage(p: string): WikiPage | null {
  const rel = safeWikiPath(p);
  const file = sub("wiki", rel);
  if (!fs.existsSync(file)) return null;
  const { data, content } = matter(fs.readFileSync(file, "utf8"));
  const upd = data.updated as unknown;
  return {
    path: rel,
    title: String(data.title ?? rel),
    kind: (data.kind as WikiKind) ?? kindFromPath(rel),
    updated: upd instanceof Date ? upd.toISOString() : String(upd ?? ""),
    sources: Array.isArray(data.sources) ? data.sources.map(Number) : [],
    human_edited: data.human_edited === true ? true : undefined,
    human_blocks: Array.isArray(data.human_blocks) ? data.human_blocks.map(String) : undefined,
    body: content.replace(/^\n+/, ""),
  };
}
export function writePage(page: WikiPage) {
  const rel = safeWikiPath(page.path);
  const fm: Record<string, unknown> = {
    title: page.title,
    kind: page.kind,
    updated: page.updated,
    sources: [...new Set(page.sources)].sort((a, b) => a - b),
  };
  if (page.human_edited) fm.human_edited = true;
  if (page.human_blocks?.length) fm.human_blocks = page.human_blocks;
  const file = sub("wiki", rel);
  ensure(path.dirname(file));
  fs.writeFileSync(file, matter.stringify(page.body.trim() + "\n", fm));
}
export function listPages(): WikiPage[] {
  const root = sub("wiki");
  if (!fs.existsSync(root)) return [];
  const out: WikiPage[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(dir, e.name), `${prefix}${e.name}/`);
      else if (e.name.endsWith(".md")) {
        const p = readPage(`${prefix}${e.name}`);
        if (p) out.push(p);
      }
    }
  };
  walk(root, "");
  const order = ["overview", "person", "project", "decisions", "open-loops", "timeline", "glossary"];
  return out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.path.localeCompare(b.path));
}

/* ---------- chats ---------- */
export function listChats(): Omit<Chat, "messages">[] {
  const dir = sub("chats");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => readJson<Chat | null>(path.join(dir, f), null))
    .filter((c): c is Chat => !!c)
    .map(({ id, title, createdAt }) => ({ id, title, createdAt }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function getChat(id: string): Chat | null {
  if (!/^[\w-]+$/.test(id)) return null;
  return readJson<Chat | null>(sub("chats", `${id}.json`), null);
}
export function saveChat(c: Chat) {
  if (!/^[\w-]+$/.test(c.id)) throw new Error("invalid chat id");
  writeJson(sub("chats", `${c.id}.json`), c);
}

/* ---------- tasks & log ---------- */
export const listTasks = (): Task[] => readJson<Task[]>(sub("tasks.json"), []);
export const saveTasks = (t: Task[]) => writeJson(sub("tasks.json"), t);
export const listRuns = (): CompileRun[] => readJson<CompileRun[]>(sub("compile-log.json"), []);
export function appendRun(r: CompileRun) {
  writeJson(sub("compile-log.json"), [...listRuns(), r]);
}

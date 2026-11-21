import { promises as fs } from "node:fs";
import path from "node:path";
import type { Document, DocumentMeta, NewsItem, Obligor, Watchlist } from "./types";

export function dataDir(): string {
  return path.resolve(process.env.DATA_DIR || "./data");
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw e;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2));
  await fs.rename(tmp, file);
}

const f = (name: string) => path.join(dataDir(), name);
const safeId = (id: string) => id.replace(/[^a-zA-Z0-9_.-]/g, "_");

export const store = {
  readJson,
  writeJson,
  async listObligors(): Promise<Obligor[]> {
    return readJson<Obligor[]>(f("obligors.json"), []);
  },
  async getObligor(id: string): Promise<Obligor | undefined> {
    return (await this.listObligors()).find((o) => o.id === id);
  },
  async saveObligors(list: Obligor[]): Promise<void> {
    await writeJson(f("obligors.json"), list);
  },
  async saveObligor(o: Obligor): Promise<void> {
    const list = await this.listObligors();
    const i = list.findIndex((x) => x.id === o.id);
    if (i >= 0) list[i] = o;
    else list.push(o);
    await this.saveObligors(list);
  },
  async getDocument(id: string): Promise<Document | undefined> {
    return readJson<Document | undefined>(path.join(dataDir(), "documents", `${safeId(id)}.json`), undefined);
  },
  async saveDocument(d: Document): Promise<void> {
    await writeJson(path.join(dataDir(), "documents", `${safeId(d.id)}.json`), d);
  },
  async listDocuments(ids: string[]): Promise<Document[]> {
    const docs = await Promise.all(ids.map((id) => this.getDocument(id)));
    return docs.filter((d): d is Document => !!d);
  },
  async listNews(): Promise<NewsItem[]> {
    return readJson<NewsItem[]>(f("news.json"), []);
  },
  async saveNews(items: NewsItem[]): Promise<void> {
    await writeJson(f("news.json"), items);
  },
  async listWatchlists(): Promise<Watchlist[]> {
    return readJson<Watchlist[]>(f("watchlists.json"), []);
  },
  async saveWatchlists(w: Watchlist[]): Promise<void> {
    await writeJson(f("watchlists.json"), w);
  },
  async reset(): Promise<void> {
    await fs.rm(dataDir(), { recursive: true, force: true });
    await fs.mkdir(path.join(dataDir(), "documents"), { recursive: true });
  },
};

export function toMeta(d: Document): DocumentMeta {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { pages, chunks, ...rest } = d;
  return { ...rest, chunkCount: chunks.length };
}

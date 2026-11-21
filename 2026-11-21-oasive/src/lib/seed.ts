import { promises as fs } from "node:fs";
import path from "node:path";
import { SEED_DOCS, SEED_NEWS, SEED_OBLIGORS } from "@/seed";
import { store } from "./store";
import { ingestDocument, ingestNews } from "./service";
import { mode } from "./llm";
import { DEFAULT_WATCHLIST_ID } from "./watchlists";
import { isoDate } from "./text";
import type { Obligor } from "./types";

const day = 86400_000;

export function fillDates(text: string, now = new Date()): string {
  return text.replace(/\{\{d-(\d+)\}\}/g, (_, n) => isoDate(new Date(now.getTime() - Number(n) * day)));
}

/** Idempotent: wipes data/ and rebuilds it from src/seed/. */
export async function seedAll() {
  const now = new Date();
  await store.reset();
  const ts = now.toISOString();
  const obligors: Obligor[] = SEED_OBLIGORS.map((o) => ({
    ...o, metrics: [], events: [], documentIds: [], createdAt: ts, updatedAt: ts,
  }));
  await store.saveObligors(obligors);
  for (const d of SEED_DOCS) {
    const raw = await fs.readFile(path.join(process.cwd(), "src", "seed", "docs", d.file), "utf8");
    await ingestDocument({
      id: `doc-${d.file.replace(/\.txt$/, "")}`, obligorId: d.obligorId, filename: d.file, buffer: Buffer.from(fillDates(raw, now)),
      type: d.type, fiscalYear: d.fiscalYear, title: d.title,
    });
  }
  for (const n of SEED_NEWS) {
    await ingestNews({
      id: n.id, title: n.title, text: n.text, source: n.source,
      publishedAt: new Date(now.getTime() - n.daysAgo * day).toISOString(),
    });
  }
  await store.saveWatchlists([{ id: DEFAULT_WATCHLIST_ID, name: "Default", obligorIds: [], createdAt: ts }]);
  const finalObligors = await store.listObligors();
  const news = await store.listNews();
  return {
    mode: mode(),
    obligors: finalObligors.length,
    documents: finalObligors.reduce((a, o) => a + o.documentIds.length, 0),
    news: news.length,
    creditRelevantNews: news.filter((n) => n.creditRelevant).length,
    filteredNews: news.filter((n) => !n.creditRelevant).length,
  };
}

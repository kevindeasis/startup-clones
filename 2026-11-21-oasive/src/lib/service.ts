import { JSDOM, VirtualConsole } from "jsdom";
import { Readability } from "@mozilla/readability";
import RSSParser from "rss-parser";
import { store, toMeta } from "./store";
import { chunkPages } from "./chunker";
import { buildCitation } from "./citations";
import { splitPages } from "./pages";
import { answerQuestion, classifyNews, extractFromDocument, mode } from "./llm";
import { retrieve } from "./search";
import { assertSafeUrl } from "./ssrf";
import { isoDate, uid } from "./text";
import { DEFAULT_WATCHLIST_ID } from "./watchlists";
import type { AnswerCitation, Citation, DocType, Document, Event, Metric, NewsItem, Obligor, Source } from "./types";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const SECTOR_METRICS: Record<string, string[]> = {
  hospital: ["Days cash on hand", "Operating margin", "Debt service coverage"],
  city: ["Fund balance % of expenditures", "Top-10 taxpayer concentration", "Pension funded ratio"],
  county: ["Fund balance % of expenditures", "Top-10 taxpayer concentration", "Pension funded ratio"],
  water_utility: ["Debt service coverage", "Days cash on hand", "Rate increase"],
  school: ["Enrollment", "Fund balance % of expenditures", "Days cash on hand"],
  airport: ["Enplaned passengers", "Debt service coverage", "Days cash on hand"],
  university: ["Enrollment", "Operating margin", "Days cash on hand"],
};

// ------------------------------------------------------------------ obligors

export async function requireObligor(id: string): Promise<Obligor> {
  const o = await store.getObligor(id);
  if (!o) throw new HttpError(404, `Unknown obligor: ${id}`);
  return o;
}

function newsEvents(o: Obligor, news: NewsItem[]): Event[] {
  return news
    .filter((n) => n.creditRelevant && n.obligorIds.includes(o.id))
    .map((n) => ({
      id: `news-${n.id}-${o.id}`, obligorId: o.id, type: n.eventType, severity: n.severity, headline: n.title,
      summary: n.summary, dollarAmounts: n.dollarAmounts, date: n.publishedAt.slice(0, 10),
      source: { kind: "news" as const, newsId: n.id },
    }));
}

export function sortEvents(events: Event[]): Event[] {
  return [...events].sort((a, b) => b.date.localeCompare(a.date));
}

export async function allEvents(o: Obligor, news?: NewsItem[]): Promise<Event[]> {
  return sortEvents([...o.events, ...newsEvents(o, news ?? (await store.listNews()))]);
}

const isFlag = (e: Event) => e.severity === "high" || e.severity === "medium";

export async function obligorSummaries() {
  const [obligors, news] = await Promise.all([store.listObligors(), store.listNews()]);
  return Promise.all(
    obligors.map(async (o) => {
      const events = await allEvents(o, news);
      const docs = await store.listDocuments(o.documentIds);
      const last = docs.map((d) => d.createdAt.slice(0, 10)).sort().pop();
      return {
        id: o.id, name: o.name, state: o.state, sector: o.sector, rating: o.rating,
        outstandingDebtUsd: o.outstandingDebtUsd, openFlags: events.filter(isFlag).length,
        lastDocumentDate: last ?? null, documentCount: docs.length,
      };
    }),
  );
}

export async function obligorDetail(id: string) {
  const o = await requireObligor(id);
  const [news, docs] = await Promise.all([store.listNews(), store.listDocuments(o.documentIds)]);
  const events = await allEvents(o, news);
  return {
    ...o, events, metrics: dedupeMetrics(o.metrics), documents: docs.map(toMeta), mode: mode(),
  };
}

/** One metric per (name, fiscalYear): prefer verified citations, then the most recently added. */
export function dedupeMetrics(metrics: Metric[]): Metric[] {
  const map = new Map<string, Metric>();
  for (const m of metrics) {
    const key = `${m.name}|${m.fiscalYear}`;
    const cur = map.get(key);
    if (!cur || (m.citation.verified && !cur.citation.verified)) map.set(key, m);
  }
  return Array.from(map.values());
}

// ------------------------------------------------------------------ documents

export async function extractPages(filename: string, buf: Buffer): Promise<string[]> {
  if (/\.pdf$/i.test(filename)) {
    const { extractText } = await import("unpdf");
    const res = await extractText(new Uint8Array(buf), { mergePages: false });
    const pages = (Array.isArray(res.text) ? res.text : [res.text]).map((t) => t.trim());
    return pages;
  }
  if (/\.(txt|md|markdown)$/i.test(filename)) return splitPages(buf.toString("utf8"));
  throw new HttpError(400, "Unsupported file type; upload .pdf, .txt or .md");
}

export async function ingestDocument(input: {
  obligorId: string; filename: string; buffer: Buffer; type: DocType; fiscalYear?: number; title?: string;
  id?: string; date?: string;
}) {
  const obligor = await requireObligor(input.obligorId);
  const pages = await extractPages(input.filename, input.buffer);
  if (!pages.some((p) => p.trim())) throw new HttpError(422, "No extractable text found in the file");
  const id = input.id ?? uid("doc");
  const title = input.title?.trim() || input.filename.replace(/\.[^.]+$/, "");
  const doc: Document = {
    id, obligorId: obligor.id, title, type: input.type, fiscalYear: input.fiscalYear, filename: input.filename,
    pageCount: pages.length, pages, chunks: chunkPages(id, pages), status: "indexed", mode: mode(),
    createdAt: new Date().toISOString(),
  };
  const extraction = await extractFromDocument(pages, { id, title, type: input.type, fiscalYear: input.fiscalYear, date: input.date }, obligor);
  const cite = (raw: { page: number; quote: string }): Citation => buildCitation(doc, raw);
  const metrics: Metric[] = extraction.metrics.map((m, i) => ({
    id: `${id}-m${i}`, name: m.name, value: m.value, unit: m.unit, fiscalYear: m.fiscalYear, citation: cite(m),
  }));
  const fallbackDate = input.date ?? isoDate(new Date());
  const events: Event[] = extraction.events.map((e, i) => ({
    id: `${id}-e${i}`, obligorId: obligor.id, type: e.type, severity: e.severity, headline: e.headline, summary: e.summary,
    dollarAmounts: e.dollarAmount != null ? [e.dollarAmount] : [], date: (e.date ?? fallbackDate).slice(0, 10),
    source: { kind: "document", citation: cite(e) },
  }));
  await store.saveDocument(doc);
  const fresh = (await store.getObligor(obligor.id)) ?? obligor;
  const updated: Obligor = {
    ...fresh,
    metrics: [...fresh.metrics.filter((m) => m.citation.docId !== id), ...metrics],
    events: [...fresh.events.filter((e) => e.source.kind !== "document" || e.source.citation.docId !== id), ...events],
    documentIds: fresh.documentIds.includes(id) ? fresh.documentIds : [...fresh.documentIds, id],
    rating: extraction.rating ?? fresh.rating,
    outstandingDebtUsd: extraction.outstandingDebtUsd ?? fresh.outstandingDebtUsd,
    updatedAt: new Date().toISOString(),
  };
  await store.saveObligor(updated);
  return {
    document: toMeta(doc),
    extraction: {
      metrics: metrics.length,
      events: events.length,
      unverified: metrics.filter((m) => !m.citation.verified).length + events.filter((e) => e.source.kind === "document" && !e.source.citation.verified).length,
      rating: extraction.rating,
    },
    metrics, events, mode: mode(),
  };
}

// ------------------------------------------------------------------ news

export async function ingestNews(input: {
  title: string; text: string; source?: string; url?: string; publishedAt?: string; id?: string;
}): Promise<NewsItem> {
  const obligors = await store.listObligors();
  const c = await classifyNews(input, obligors);
  const now = new Date().toISOString();
  const item: NewsItem = {
    id: input.id ?? uid("news"), title: input.title.trim(), text: input.text.trim(), source: input.source?.trim() || "pasted",
    url: input.url, publishedAt: input.publishedAt ?? now, creditRelevant: c.creditRelevant, obligorIds: c.obligorIds,
    eventType: c.eventType, severity: c.severity, summary: c.summary, dollarAmounts: c.dollarAmounts, mode: mode(), createdAt: now,
  };
  const list = await store.listNews();
  await store.saveNews([item, ...list.filter((n) => n.id !== item.id)]);
  return item;
}

export async function fetchArticle(url: string): Promise<{ title: string; text: string; source: string }> {
  const err = await assertSafeUrl(url);
  if (err) throw new HttpError(400, err);
  let res: Response;
  try {
    res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15000), headers: { "user-agent": "MuniWatch-learning-clone/1.0" } });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new HttpError(502, "Redirect without location");
      const next = new URL(loc, url).toString();
      const err2 = await assertSafeUrl(next);
      if (err2) throw new HttpError(400, err2);
      res = await fetch(next, { redirect: "follow", signal: AbortSignal.timeout(15000) });
    }
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, `Could not fetch URL: ${(e as Error).message}`);
  }
  if (!res.ok) throw new HttpError(502, `Fetching the URL returned HTTP ${res.status}`);
  const html = await res.text();
  const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() });
  const article = new Readability(dom.window.document).parse();
  if (!article?.textContent?.trim()) throw new HttpError(422, "Could not extract an article from that page");
  return { title: article.title || new URL(url).hostname, text: article.textContent.trim(), source: new URL(url).hostname };
}

export async function pollFeeds(): Promise<{ fetched: number; ingested: number }> {
  const feeds = (process.env.NEWS_FEEDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!feeds.length) throw new HttpError(400, "NEWS_FEEDS is not set");
  const parser = new RSSParser({ timeout: 15000 });
  const known = new Set((await store.listNews()).map((n) => n.url).filter(Boolean));
  let fetched = 0;
  let ingested = 0;
  for (const feed of feeds) {
    if (await assertSafeUrl(feed)) continue;
    const parsed = await parser.parseURL(feed);
    for (const it of parsed.items.slice(0, 25)) {
      fetched++;
      if (!it.title || (it.link && known.has(it.link))) continue;
      await ingestNews({
        title: it.title, text: it.contentSnippet || it.content || it.title, source: parsed.title || new URL(feed).hostname,
        url: it.link, publishedAt: it.isoDate || undefined,
      });
      ingested++;
    }
  }
  return { fetched, ingested };
}

export async function newsFeed(f: { obligorId?: string; type?: string; severity?: string; watchlistId?: string; includeFiltered?: boolean }) {
  let items = await store.listNews();
  if (!f.includeFiltered) items = items.filter((n) => n.creditRelevant);
  if (f.obligorId) items = items.filter((n) => n.obligorIds.includes(f.obligorId!));
  if (f.type) items = items.filter((n) => n.eventType === f.type);
  if (f.severity) items = items.filter((n) => n.severity === f.severity);
  if (f.watchlistId) {
    const wl = (await store.listWatchlists()).find((w) => w.id === f.watchlistId);
    if (!wl) throw new HttpError(404, `Unknown watchlist: ${f.watchlistId}`);
    items = items.filter((n) => n.obligorIds.some((id) => wl.obligorIds.includes(id)));
  }
  return items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

// ------------------------------------------------------------------ ask

export async function askObligor(obligorId: string, question: string) {
  const o = await requireObligor(obligorId);
  const hits = await retrieve(o.id, o.documentIds, question, 8);
  const sources: Source[] = hits.map((h, i) => ({ ...h, n: i + 1 }));
  const res = await answerQuestion(question, sources, o.name);
  const citations: (AnswerCitation & { verified: boolean })[] = res.citations.map((c) => ({ ...c, verified: true }));
  return { obligorId: o.id, obligorName: o.name, answer: res.answer, citations };
}

// ------------------------------------------------------------------ watchlists

export async function ensureDefaultWatchlist() {
  const list = await store.listWatchlists();
  if (!list.some((w) => w.id === DEFAULT_WATCHLIST_ID)) {
    list.unshift({ id: DEFAULT_WATCHLIST_ID, name: "Default", obligorIds: [], createdAt: new Date().toISOString() });
    await store.saveWatchlists(list);
  }
  return list;
}

export async function watchlistDetails() {
  const [lists, obligors, news] = await Promise.all([ensureDefaultWatchlist(), store.listObligors(), store.listNews()]);
  const cutoff = isoDate(new Date(Date.now() - 30 * 86400_000));
  const rows = await Promise.all(
    obligors.map(async (o) => {
      const events = await allEvents(o, news);
      return { o, events, high30: events.filter((e) => e.severity === "high" && e.date >= cutoff).length };
    }),
  );
  return lists.map((w) => {
    const members = rows.filter((r) => w.obligorIds.includes(r.o.id));
    return {
      ...w,
      obligors: members.map((r) => ({ id: r.o.id, name: r.o.name, sector: r.o.sector, state: r.o.state, highEvents30d: r.high30 })),
      events: sortEvents(members.flatMap((r) => r.events)).slice(0, 40).map((e) => ({ ...e, obligorName: members.find((r) => r.o.id === e.obligorId)?.o.name ?? e.obligorId })),
    };
  });
}


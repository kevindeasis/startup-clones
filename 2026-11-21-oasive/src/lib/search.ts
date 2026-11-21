import MiniSearch from "minisearch";
import type { Document, Source } from "./types";
import { store } from "./store";

const STOP = new Set(
  "a an and are as at be by for from has have how in is it its of on or that the their this to was were what when where which who why will with did does do about into than then over under per".split(
    " ",
  ),
);

type Doc = { id: string; docId: string; docTitle: string; page: number; text: string };

export function buildIndex(docs: Document[]): MiniSearch<Doc> {
  const ms = new MiniSearch<Doc>({
    fields: ["text", "docTitle"],
    storeFields: ["docId", "docTitle", "page", "text"],
    processTerm: (t) => {
      const l = t.toLowerCase();
      return STOP.has(l) ? null : l;
    },
  });
  ms.addAll(docs.flatMap((d) => d.chunks.map((c) => ({ id: c.id, docId: d.id, docTitle: d.title, page: c.page, text: c.text }))));
  return ms;
}

export function searchIndex(ms: MiniSearch<Doc>, question: string, k = 8): Omit<Source, "n">[] {
  const hits = ms.search(question, { fuzzy: 0.2, prefix: true, boost: { docTitle: 2 }, combineWith: "OR" });
  return hits.slice(0, k).map((h) => ({
    docId: h.docId as string,
    docTitle: h.docTitle as string,
    page: h.page as number,
    text: h.text as string,
  }));
}

const cache = new Map<string, { sig: string; ms: MiniSearch<Doc> }>();

/** Retrieve top-k chunks for an obligor; the index is cached in memory and rebuilt when documents change. */
export async function retrieve(obligorId: string, docIds: string[], question: string, k = 8): Promise<Omit<Source, "n">[]> {
  const docs = await store.listDocuments(docIds);
  const sig = docs.map((d) => `${d.id}:${d.chunks.length}`).join("|");
  let entry = cache.get(obligorId);
  if (!entry || entry.sig !== sig) {
    entry = { sig, ms: buildIndex(docs) };
    cache.set(obligorId, entry);
  }
  return searchIndex(entry.ms, question, k);
}

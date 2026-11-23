import MiniSearch from "minisearch";
import { getLLM } from "./llm";
import type { Chunk } from "./llm/types";
import { chunkPage } from "./pages";
import { listDocuments, getDocument } from "./data";
import { qTokens } from "./llm/mock";
import type { Answer } from "./schemas";
import type { Document } from "./types";

const STOP = new Set("a an and are as at be by for from has have how in is it of on or that the this to was what when where which who will with".split(" "));
const stem = (t: string) => (t.length > 3 ? t.replace(/(ies|es|s)$/, "") : t);

export function buildChunks(docs: Document[]): Chunk[] {
  const out: Chunk[] = [];
  for (const d of docs) {
    for (const p of d.pages) {
      for (const c of chunkPage(p)) {
        out.push({ id: `${d.id}:${c.page}:${c.index}`, documentId: d.id, docTitle: d.title, page: c.page, text: c.text });
      }
    }
  }
  return out;
}

/** BM25 retrieval (MiniSearch) over chunks; returns the top-k chunks in rank order. */
export function retrieve(question: string, chunks: Chunk[], k = 6): Chunk[] {
  if (!chunks.length) return [];
  const ms = new MiniSearch<Chunk>({
    fields: ["text"],
    storeFields: ["id"],
    processTerm: (t) => (STOP.has(t.toLowerCase()) ? null : stem(t.toLowerCase())),
  });
  ms.addAll(chunks);
  const terms = qTokens(question).join(" ");
  const hits = ms.search(terms || question, { combineWith: "OR" }).slice(0, k);
  const byId = new Map(chunks.map((c) => [c.id, c]));
  return hits.map((h) => byId.get(h.id as string)!).filter(Boolean);
}

export async function askDocument(documentId: string, question: string): Promise<Answer | undefined> {
  const doc = await getDocument(documentId);
  if (!doc) return undefined;
  const docs = [doc];
  if (doc.kind === "solicitation") {
    docs.push(...(await listDocuments()).filter((d) => d.parentDocumentId === doc.id && d.kind === "addendum"));
  }
  const chunks = retrieve(question, buildChunks(docs), 6);
  return getLLM().answerQuestion({ question, chunks });
}

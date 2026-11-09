import MiniSearch from "minisearch";
import { db, playbookClauses, precedents } from "@/db";
import type { ContextItem } from "./llm/mock";

/** Rebuilds a BM25-style index from the DB and returns top clauses + precedents. */
export function retrieve(query: string, nClauses = 6, nPrecedents = 3): ContextItem[] {
  const clauses = db.select().from(playbookClauses).all();
  const prec = db.select().from(precedents).all();

  const docs: (ContextItem & { kind: string })[] = [
    ...clauses.map((c) => ({
      id: c.id, kind: "clause" as const, practiceArea: c.practiceArea, title: c.title,
      text: `${c.title}. Standard: ${c.standardPosition} Fallback: ${c.fallbackPosition} Walk-away: ${c.walkAway}`,
    })),
    ...prec.map((p) => ({
      id: p.id, kind: "precedent" as const, practiceArea: p.practiceArea, title: `Precedent ${p.id}`,
      text: `${p.summary} Outcome: ${p.outcome}`,
    })),
  ];
  if (!docs.length) return [];

  const ms = new MiniSearch({
    fields: ["title", "text", "practiceArea"],
    storeFields: ["kind"],
    searchOptions: { prefix: true, fuzzy: 0.15, combineWith: "OR", boost: { title: 2 } },
  });
  ms.addAll(docs);

  const hits = ms.search(query);
  const byId = new Map(docs.map((d) => [d.id, d]));
  const pick = (kind: string, n: number) =>
    hits.filter((h) => byId.get(h.id)?.kind === kind).slice(0, n).map((h) => byId.get(h.id)!);
  return [...pick("clause", nClauses), ...pick("precedent", nPrecedents)];
}

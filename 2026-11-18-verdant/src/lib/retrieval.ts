import MiniSearch from "minisearch";
import { codeSections, permitTypes } from "./permits";
import type { CodeSection, PermitType } from "./types";

const index = new MiniSearch<CodeSection>({
  fields: ["title", "text"],
  storeFields: ["title", "chapter", "text"],
  searchOptions: { boost: { title: 2 }, prefix: true, fuzzy: 0.15 },
});
index.addAll(codeSections);

export type ScoredSection = CodeSection & { score: number };

export function searchCode(query: string, k = 5): ScoredSection[] {
  if (!query.trim()) return [];
  return index
    .search(query)
    .slice(0, k)
    .map((r) => ({
      id: r.id as string,
      title: r.title as string,
      chapter: r.chapter as string,
      text: r.text as string,
      score: r.score,
    }));
}

export function scorePermitTypes(query: string): { permit: PermitType; score: number }[] {
  const q = query.toLowerCase();
  return permitTypes
    .map((permit) => {
      let score = 0;
      for (const t of permit.triggers) {
        if (new RegExp("\\b" + t.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(q)) score += t.includes(" ") ? 2 : 1;
      }
      return { permit, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.permit.id.localeCompare(b.permit.id));
}

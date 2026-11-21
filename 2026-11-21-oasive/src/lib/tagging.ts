import type { Obligor } from "./types";
import { escapeRegex } from "./text";

/** Deterministic obligor tagging by name / alias match (case-insensitive, word-bounded). */
export function tagObligors(text: string, obligors: Pick<Obligor, "id" | "name" | "aliases">[]): string[] {
  const ids: string[] = [];
  for (const o of obligors) {
    const names = [o.name, ...o.aliases].filter(Boolean);
    if (names.some((n) => new RegExp(`(^|[^\\w])${escapeRegex(n)}(?![\\w])`, "i").test(text))) ids.push(o.id);
  }
  return ids;
}

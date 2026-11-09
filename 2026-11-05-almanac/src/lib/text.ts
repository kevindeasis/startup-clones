import type { Source } from "./types";

/** Render a stored source as plain text for prompts (Slack JSON becomes "user: text" lines). */
export function renderSource(s: Source): string {
  if (s.kind === "slack") {
    try {
      const arr = JSON.parse(s.text) as { user?: string; text?: string; ts?: string }[];
      return arr.map((m) => `${m.user ?? "unknown"}: ${m.text ?? ""} (${m.ts ?? ""})`).join("\n");
    } catch {
      return s.text;
    }
  }
  return s.text;
}

export const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "untitled";

export const CITE_RE = /\[src:(\d+)\]/g;
export function citedIds(text: string): number[] {
  return [...new Set([...text.matchAll(CITE_RE)].map((m) => Number(m[1])))];
}

const STOP = new Set(
  "a an and are as at be by for from has have how i in is it its of on or that the this to was were what when where which who why will with we our you your do does did about tell me can could should would there their they them us not no yes any all".split(" "),
);
export function tokenize(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !STOP.has(t));
}

/** BM25-lite: sum over query terms of tf * idf. */
export function rank<T extends { text: string }>(query: string, docs: T[]): { doc: T; score: number }[] {
  const q = [...new Set(tokenize(query))];
  const toks = docs.map((d) => tokenize(d.text));
  const N = docs.length || 1;
  const df = new Map<string, number>();
  for (const t of q) df.set(t, toks.filter((d) => d.includes(t)).length);
  return docs
    .map((doc, i) => {
      let score = 0;
      for (const t of q) {
        const tf = toks[i].filter((x) => x === t).length;
        if (!tf) continue;
        const idf = Math.log(1 + (N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
        score += (tf / (tf + 1.2)) * idf;
      }
      return { doc, score };
    })
    .sort((a, b) => b.score - a.score);
}

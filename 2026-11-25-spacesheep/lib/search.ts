import { currentVersion, listSpaces } from "./store";

export function searchSpaces(q: string, all: boolean) {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const out: any[] = [];
  for (const s of listSpaces()) {
    if (!all && s.visibility !== "public") continue;
    const hay = (s.title + " " + currentVersion(s).text).toLowerCase();
    let score = 0;
    for (const t of terms) { let i = -1; while ((i = hay.indexOf(t, i + 1)) >= 0) score++; }
    if (score > 0) {
      const idx = hay.indexOf(terms[0]);
      const text = currentVersion(s).text;
      out.push({ id: s.id, slug: s.slug, title: s.title, visibility: s.visibility, versions: s.versions.length, updated_at: s.updated_at, score, snippet: idx >= 0 ? text.slice(Math.max(0, idx - 40), idx + 100) : "" });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

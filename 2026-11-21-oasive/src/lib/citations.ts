import type { Citation, RawCitation } from "./types";
import { normalize } from "./text";

/** Verify a (page, quote) pair against page texts; fix the page if the quote lives elsewhere. */
export function verifyCitation(pages: string[], raw: RawCitation): { page: number; verified: boolean } {
  const probe = normalize(raw.quote).slice(0, 40);
  const clampedPage = Math.min(Math.max(raw.page, 1), Math.max(pages.length, 1));
  if (!probe) return { page: clampedPage, verified: false };
  const norm = pages.map(normalize);
  if (norm[raw.page - 1]?.includes(probe)) return { page: raw.page, verified: true };
  const found = norm.findIndex((p) => p.includes(probe));
  if (found >= 0) return { page: found + 1, verified: true };
  return { page: clampedPage, verified: false };
}

export function buildCitation(
  doc: { id: string; title: string; pages: string[] },
  raw: RawCitation,
): Citation {
  const v = verifyCitation(doc.pages, raw);
  return { docId: doc.id, docTitle: doc.title, page: v.page, quote: raw.quote.trim(), verified: v.verified };
}

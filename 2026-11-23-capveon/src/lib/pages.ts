import type { DocPage } from "./types";

const MARKER = /^[ \t]*-{2,}\s*page\s+\d+\s*-{2,}[ \t]*$/im;
export const PSEUDO_PAGE_CHARS = 3000;

/**
 * Split raw text into pages: `--- page N ---` marker lines, else form feeds,
 * else pseudo-pages of roughly 3,000 characters (broken at paragraph boundaries).
 */
export function splitPages(text: string, pseudoSize = PSEUDO_PAGE_CHARS): DocPage[] {
  const clean = text.replace(/\r\n/g, "\n");
  let parts: string[];
  if (MARKER.test(clean)) {
    parts = clean.split(/^[ \t]*-{2,}\s*page\s+\d+\s*-{2,}[ \t]*$/im);
  } else if (clean.includes("\f")) {
    parts = clean.split("\f");
  } else {
    parts = pseudoPages(clean, pseudoSize);
  }
  const pages = parts.map((p) => p.trim()).filter((p) => p.length > 0);
  return pages.map((p, i) => ({ n: i + 1, text: p }));
}

function pseudoPages(text: string, size: number): string[] {
  const paras = text.split(/\n{2,}/);
  const out: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (cur && cur.length + p.length + 2 > size) {
      out.push(cur);
      cur = "";
    }
    if (p.length > size) {
      // hard-wrap a very long paragraph
      for (let i = 0; i < p.length; i += size) out.push(p.slice(i, i + size));
    } else {
      cur = cur ? `${cur}\n\n${p}` : p;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Chunks for retrieval: paragraph-grouped pieces of up to ~900 characters, each tied to a page. */
export function chunkPage(page: DocPage, max = 900): { page: number; index: number; text: string }[] {
  const paras = page.text.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  const chunks: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (cur && cur.length + p.length + 2 > max) {
      chunks.push(cur);
      cur = p;
    } else cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) chunks.push(cur);
  return chunks.map((text, index) => ({ page: page.n, index, text }));
}

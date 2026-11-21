import type { Chunk } from "./types";

/**
 * Page-aware chunker: chunks never span pages. Each chunk is a contiguous slice of its page
 * (so any line inside it is a verbatim substring of the page), ~`size` characters.
 */
export function chunkPages(docId: string, pages: string[], size = 800): Chunk[] {
  const chunks: Chunk[] = [];
  pages.forEach((page, idx) => {
    const pageNo = idx + 1;
    if (!page.trim()) return;
    // Split into line segments with offsets; hard-split lines longer than size.
    const segs: { start: number; end: number }[] = [];
    let pos = 0;
    for (const line of page.split("\n")) {
      const lineEnd = pos + line.length;
      let s = pos;
      while (lineEnd - s > size) {
        segs.push({ start: s, end: s + size });
        s += size;
      }
      segs.push({ start: s, end: lineEnd });
      pos = lineEnd + 1;
    }
    let curStart = -1;
    let curEnd = -1;
    let n = 0;
    const flush = () => {
      if (curStart < 0) return;
      const text = page.slice(curStart, curEnd).trim();
      if (text) chunks.push({ id: `${docId}-p${pageNo}-c${n++}`, docId, page: pageNo, text });
      curStart = -1;
    };
    for (const seg of segs) {
      if (curStart < 0) {
        curStart = seg.start;
        curEnd = seg.end;
      } else if (seg.end - curStart > size) {
        flush();
        curStart = seg.start;
        curEnd = seg.end;
      } else {
        curEnd = seg.end;
      }
    }
    flush();
  });
  return chunks;
}

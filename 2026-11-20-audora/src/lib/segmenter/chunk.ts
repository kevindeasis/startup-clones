export type Chunk = { index: number; text: string; startParagraph: number };

export const TARGET_WORDS = 1200;

export function countWords(text: string): number {
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}

/** Normalise line endings and make sure the text has blank-line separated paragraphs. */
export function normalizeText(raw: string): string {
  let t = raw.replace(/\r\n?/g, "\n").replace(/ /g, " ").trim();
  // Hard-wrapped text with no blank lines at all: treat each line as a paragraph.
  if (!/\n[ \t]*\n/.test(t)) t = t.replace(/\n/g, "\n\n");
  return t.replace(/\n[ \t]*\n(?:[ \t]*\n)*/g, "\n\n");
}

export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n[ \t]*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Split text into ~TARGET_WORDS chunks at paragraph boundaries. A paragraph is never split,
 * so one very long paragraph simply becomes its own (oversized) chunk.
 */
export function chunkText(text: string, targetWords = TARGET_WORDS): Chunk[] {
  const paragraphs = splitParagraphs(text);
  const chunks: Chunk[] = [];
  let current: string[] = [];
  let currentWords = 0;
  let startParagraph = 0;
  paragraphs.forEach((p, i) => {
    const w = countWords(p);
    if (current.length > 0 && currentWords + w > targetWords) {
      chunks.push({ index: chunks.length, text: current.join("\n\n"), startParagraph });
      current = [];
      currentWords = 0;
      startParagraph = i;
    }
    current.push(p);
    currentWords += w;
  });
  if (current.length > 0) chunks.push({ index: chunks.length, text: current.join("\n\n"), startParagraph });
  return chunks;
}

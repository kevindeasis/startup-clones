/** Split plain text on `=== Page N ===` markers; without markers the whole text is one page. */
export function splitPages(text: string): string[] {
  const re = /^=== Page \d+ ===[ \t]*$/m;
  if (!re.test(text)) return [text.trim()];
  const parts = text.split(/^=== Page \d+ ===[ \t]*$/m);
  const preamble = parts.shift() ?? "";
  const pages = parts.map((p) => p.replace(/^\n+|\s+$/g, ""));
  if (preamble.trim() && pages.length) pages[0] = `${preamble.trim()}\n${pages[0]}`;
  return pages.length ? pages : [text.trim()];
}

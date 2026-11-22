/** Minimal CSV parser (no quoted commas needed for our data): returns rows keyed by header. */
export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const head = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((l) => {
    const cells = l.split(",").map((c) => c.trim());
    return Object.fromEntries(head.map((h, i) => [h, cells[i] ?? ""]));
  });
}

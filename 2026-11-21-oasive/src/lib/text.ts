export function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Parse every dollar amount in a string: "$18,400,000", "$14.2 million", "$1.1bn". */
export function parseDollarAmounts(text: string): number[] {
  const out: number[] = [];
  const re = /\$\s?(\d[\d,]*(?:\.\d+)?)\s?(billion|million|thousand|bn|m|k)?\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let v = parseFloat(m[1].replace(/,/g, ""));
    if (Number.isNaN(v)) continue;
    const mult = (m[2] ?? "").toLowerCase();
    if (mult === "billion" || mult === "bn") v *= 1e9;
    else if (mult === "million" || mult === "m") v *= 1e6;
    else if (mult === "thousand" || mult === "k") v *= 1e3;
    out.push(Math.round(v));
  }
  return out;
}

export function firstSentences(text: string, n: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const parts = clean.match(/[^.!?]+[.!?]+(\s|$)/g);
  if (!parts) return clean.slice(0, 300);
  return parts.slice(0, n).join("").trim();
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

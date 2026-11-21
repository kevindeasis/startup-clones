import type {
  Answer, DocMeta, EventType, ExtractedEvent, ExtractedMetric, Extraction, NewsClassification, Obligor, Severity,
  Source, Unit,
} from "./types";
import { firstSentences, parseDollarAmounts } from "./text";
import { tagObligors } from "./tagging";

// ------------------------------------------------------------------ document extraction

const num = (s: string) => parseFloat(s.replace(/,/g, ""));
const sign = (s: string | undefined) => (s && /^[-−(]/.test(s) ? -1 : 1);

type MetricPattern = { name: string; unit: Unit; re: RegExp; value: (m: RegExpMatchArray) => number };

export const METRIC_PATTERNS: MetricPattern[] = [
  { name: "Days cash on hand", unit: "days", re: /days cash on hand\s*[:\-]?\s*(\d[\d,]*(?:\.\d+)?)/i, value: (m) => num(m[1]) },
  {
    name: "Operating margin", unit: "pct",
    re: /operating margin\s*[:\-]?\s*([-−(]?)\s*(\d+(?:\.\d+)?)\)?\s*%/i,
    value: (m) => sign(m[1]) * num(m[2]),
  },
  { name: "Debt service coverage", unit: "x", re: /debt service coverage(?: ratio)?\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*x/i, value: (m) => num(m[1]) },
  {
    name: "Total governmental fund balance", unit: "usd",
    re: /total governmental fund balance\s*[:\-]?\s*\$\s*(\d[\d,]*(?:\.\d+)?)\s*(million|billion)?/i,
    value: (m) => num(m[1]) * (/billion/i.test(m[2] ?? "") ? 1e9 : /million/i.test(m[2] ?? "") ? 1e6 : 1),
  },
  {
    name: "Fund balance % of expenditures", unit: "pct",
    re: /unassigned fund balance[^\n%]*?(\d+(?:\.\d+)?)\s*%\s*of\s*(?:the\s+)?(?:general fund\s+|operating\s+)?expenditures/i,
    value: (m) => num(m[1]),
  },
  { name: "Enrollment", unit: "count", re: /\benrollment\s*[:\-]?\s*(\d[\d,]*)/i, value: (m) => num(m[1]) },
  { name: "Pension funded ratio", unit: "pct", re: /pension funded ratio\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*%/i, value: (m) => num(m[1]) },
  {
    name: "Top-10 taxpayer concentration", unit: "pct",
    re: /top[\s-]ten taxpayers[^\n%]*?(\d+(?:\.\d+)?)\s*%/i, value: (m) => num(m[1]),
  },
  { name: "Rate increase", unit: "pct", re: /(?:annual |adopted )?rate increase\s*[:\-]\s*(\d+(?:\.\d+)?)\s*%/i, value: (m) => num(m[1]) },
  { name: "Enplaned passengers", unit: "count", re: /enplaned passengers\s*[:\-]?\s*(\d[\d,]*)/i, value: (m) => num(m[1]) },
  {
    name: "Outstanding debt", unit: "usd",
    re: /total (?:outstanding )?debt(?: outstanding)?\s*[:\-]?\s*\$\s*(\d[\d,]*(?:\.\d+)?)\s*(million|billion)?/i,
    value: (m) => num(m[1]) * (/billion/i.test(m[2] ?? "") ? 1e9 : /million/i.test(m[2] ?? "") ? 1e6 : 1),
  },
];

const RATING_RE = /\brating\s*[:\-]\s*(Aaa|Aa[123]|A[123]|Baa[123]|Ba[123]|B[123]|Caa[123]?|Ca|AAA|AA[+-]?|A[+-]|BBB[+-]?|BB[+-]?|B[+-]|CCC|CC)(?![A-Za-z0-9])/i;
const FY_RE = /\b(?:FY|fiscal year)\s*'?\s*(20\d\d)\b/i;
const DATE_RE = /\b(20\d\d-\d\d-\d\d)\b/;

type EventRule = { re: RegExp; type: EventType; severity: Severity };
// Ordered: first match wins for a line.
const EVENT_RULES: EventRule[] = [
  { re: /emergency manager|state oversight|fiscal oversight|oversight commission|receivership/i, type: "state_oversight", severity: "high" },
  { re: /covenant|default|forbearance/i, type: "distress", severity: "high" },
  { re: /downgrad/i, type: "rating", severity: "high" },
  { re: /resign/i, type: "leadership", severity: "medium" },
  { re: /lawsuit|litigation|\bsued\b/i, type: "litigation", severity: "medium" },
  { re: /deficit/i, type: "budget", severity: "medium" },
  { re: /rate increase/i, type: "budget", severity: "low" },
  { re: /\bissued\s+\$|\bissuance of\s+\$|\bapproved the issuance/i, type: "debt_issuance", severity: "low" },
];

export function mockExtract(pages: string[], meta: DocMeta): Extraction {
  const metrics: ExtractedMetric[] = [];
  const events: ExtractedEvent[] = [];
  let rating: string | undefined;
  let outstandingDebtUsd: number | undefined;
  const docDate = pages.join("\n").match(DATE_RE)?.[1] ?? meta.date;
  const baseFy = meta.fiscalYear ?? (docDate ? Number(docDate.slice(0, 4)) : new Date().getUTCFullYear());
  let headingFy: number | undefined;
  const seenMetric = new Set<string>();

  pages.forEach((page, pi) => {
    for (const rawLine of page.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      const inlineFy = line.match(FY_RE);
      let matched = false;
      for (const p of METRIC_PATTERNS) {
        const m = line.match(p.re);
        if (!m) continue;
        matched = true;
        const fy = inlineFy ? Number(inlineFy[1]) : headingFy ?? baseFy;
        const value = p.value(m);
        if (p.name === "Outstanding debt") outstandingDebtUsd = value;
        const key = `${p.name}|${fy}|${pi}`;
        if (seenMetric.has(key)) continue;
        seenMetric.add(key);
        metrics.push({ name: p.name, value, unit: p.unit, fiscalYear: fy, page: pi + 1, quote: line });
      }
      const rm = line.match(RATING_RE);
      if (rm) {
        matched = true;
        rating = rm[1][0].toUpperCase() + rm[1].slice(1);
      }
      if (matched) continue;
      if (inlineFy && line.length < 90 && !EVENT_RULES.some((r) => r.re.test(line))) {
        headingFy = Number(inlineFy[1]); // heading line such as "FISCAL YEAR 2024 - Key indicators"
        continue;
      }
      if (events.length >= 8) continue;
      const rule = EVENT_RULES.find((r) => r.re.test(line));
      if (!rule) continue;
      const amounts = parseDollarAmounts(line);
      events.push({
        type: rule.type, severity: rule.severity,
        headline: line.length > 110 ? line.slice(0, 107) + "..." : line,
        summary: firstSentences(line, 2), dollarAmount: amounts[0],
        page: pi + 1, quote: line, date: docDate,
      });
    }
  });
  return { metrics, events, rating, outstandingDebtUsd };
}

// ------------------------------------------------------------------ news classification

const NEWS_RULES: { type: EventType; weight: number; kws: string[] }[] = [
  { type: "state_oversight", weight: 5, kws: ["oversight", "emergency manager", "receivership", "fiscal control board", "state takeover", "financial emergency"] },
  { type: "distress", weight: 5, kws: ["covenant", "default", "forbearance", "bankruptcy", "chapter 9", "chapter 11", "going concern", "insolven", "layoff", "lays off", "missed payment", "cash shortfall", "liquidity"] },
  { type: "rating", weight: 4, kws: ["downgrad", "upgrad", "rating outlook", "negative outlook", "positive outlook", "moody", "s&p", "fitch", "credit watch"] },
  { type: "litigation", weight: 3, kws: ["lawsuit", "sued", "settlement", "class action", "judgment"] },
  { type: "leadership", weight: 3, kws: ["resign", "steps down", "stepped down", "fired", "interim superintendent", "interim ceo", "cfo"] },
  { type: "debt_issuance", weight: 2, kws: ["bond sale", "revenue bonds", "general obligation bonds", "bonds", "refunding", "priced", "issuance"] },
  { type: "budget", weight: 2, kws: ["deficit", "budget", "rate increase", "tax increase", "shortfall", "millage"] },
];
const STRONG = /downgrad|default|covenant|emergency manager|bankruptcy|receivership|state oversight|fiscal oversight/i;

export function mockClassifyNews(
  item: { title: string; text: string },
  obligors: Pick<Obligor, "id" | "name" | "aliases">[],
): NewsClassification {
  const full = `${item.title}. ${item.text}`;
  const lower = full.toLowerCase();
  const obligorIds = tagObligors(full, obligors);
  const scores = NEWS_RULES.map((r) => ({
    type: r.type,
    score: r.kws.filter((k) => new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(lower)).length * r.weight,
  }));
  const best = scores.reduce((a, b) => (b.score > a.score ? b : a), { type: "other" as EventType, score: 0 });
  const hit = best.score > 0;
  const creditRelevant = hit && (obligorIds.length > 0 || STRONG.test(lower));
  const dollarAmounts = parseDollarAmounts(full);
  const eventType: EventType = creditRelevant ? best.type : "other";
  let severity: Severity = "low";
  if (creditRelevant) {
    if (eventType === "state_oversight") severity = "high";
    else if (eventType === "distress") severity = /default|covenant|forbearance|bankruptcy|chapter/.test(lower) ? "high" : "medium";
    else if (eventType === "rating") severity = /downgrad|negative outlook|credit watch/.test(lower) ? (/below investment|speculative|junk|ba\d|bb\+?/.test(lower) ? "high" : "medium") : "low";
    else if (eventType === "litigation" || eventType === "leadership") severity = /resign|fired|steps down|stepped down|lawsuit|sued/.test(lower) ? "medium" : "low";
    else if (eventType === "budget") severity = /deficit|shortfall/.test(lower) ? "medium" : "low";
    if (severity === "low" && dollarAmounts.some((d) => d >= 50_000_000) && eventType !== "debt_issuance") severity = "medium";
  }
  return {
    creditRelevant, obligorIds, eventType, severity,
    summary: firstSentences(item.text || item.title, 2), dollarAmounts,
  };
}

// ------------------------------------------------------------------ Q&A

export function bestQuote(text: string, question: string, max = 240): string {
  const terms = question.toLowerCase().match(/[a-z0-9%$.]{3,}/g) ?? [];
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  let best = lines[0] ?? text.trim();
  let bestScore = -1;
  for (const l of lines) {
    const low = l.toLowerCase();
    const s = terms.filter((t) => low.includes(t)).length;
    if (s > bestScore) {
      bestScore = s;
      best = l;
    }
  }
  return best.length > max ? best.slice(0, max) : best;
}

export function mockAnswer(question: string, sources: Source[], obligorName?: string): Answer {
  if (sources.length === 0) {
    return { answer: "No indexed document passages match this question, so no sourced answer can be given.", citations: [] };
  }
  const top = sources.slice(0, 3);
  const citations = top.map((s) => ({ n: s.n, docId: s.docId, docTitle: s.docTitle, page: s.page, quote: bestQuote(s.text, question) }));
  const parts = citations.map((c) => `${c.docTitle} (p. ${c.page}) states: "${c.quote}" [${c.n}]`);
  const answer = `[mock answer] The most relevant passages${obligorName ? ` for ${obligorName}` : ""} on "${question}": ${parts.join("; ")}.`;
  return { answer, citations };
}

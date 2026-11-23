import type { Answer, ExtractedSignal, RawRequirement } from "../schemas";
import type { Category, Change, ChangeField, Requirement, Stage } from "../types";
import { REQ_CUE, classifyRequirement } from "../requirements";
import { templateRationale } from "../fit";
import { findDates, formatMoney, parseMoney, sentences } from "../util";
import type { Chunk, LLM } from "./types";

// ---------- signals ----------
const CUE = /\b(project|replacement|rehabilitation|expansion|upgrade|construction|improvements?|study|design|RFP|IFB|bid|procurement)\b/i;
const NOUN =
  /\b(pump|pumps|station|stations|water main|sewer|lift|wet well|force main|road|roads|pavement|bridge|culvert|drainage|storm|treatment|plant|reservoir|tank|pipeline|resurfacing|valve|valves|booster|intersection|main)\b/i;

const CATEGORY_TABLE: [Category, RegExp][] = [
  ["wastewater", /sewer|lift station|wastewater|WWTP|force main|wet well|manhole/gi],
  ["stormwater", /storm|culvert|drainage|detention/gi],
  ["roads_bridges", /\broad|pavement|bridge|resurfac|asphalt|intersection|highway|\broute \d/gi],
  ["water", /pump|water main|treatment|AWWA|booster|reservoir|\btank|hydrant|potable|\bwater\b|valve/gi],
  ["buildings", /building|facility|\broof|hvac/gi],
  ["energy", /solar|substation|transformer|electric/gi],
  ["industrial", /industrial|manufactur/gi],
  ["it_telecom", /broadband|fiber|network|software/gi],
];

export function mockCategory(text: string): Category {
  let best: Category = "buildings";
  let bestN = 0;
  for (const [cat, re] of CATEGORY_TABLE) {
    const n = (text.match(re) ?? []).length;
    if (n > bestN) {
      best = cat;
      bestN = n;
    }
  }
  return best;
}

export function mockStage(textIn: string): Stage {
  const text = textIn.replace(/\b(will|to|shall|may|be)\s+(?:be\s+)?awarded\b/gi, " ");
  if (/\bawarded\b|notice of award/i.test(text)) return "awarded";
  if (/\bRFP\b|\bIFB\b|bids due|sealed bids|request for (proposals|bids)|invitation for bids?/i.test(text)) return "solicitation";
  if (/\bdesign\b|engineering services|\b(30|60|90)%/i.test(text)) return "design";
  if (/budget|appropriat|approved funding/i.test(text)) return "budgeted";
  if (/planned|five-year|\bCIP\b|capital improvement|\bFY\s?20\d\d/i.test(text)) return "planned";
  return "discussion";
}

function cleanHeading(h: string): string {
  let t = h.replace(/^#+\s*/, "").replace(/\s*\([^)]*\)\s*$/, "").trim();
  t = t.replace(/^(agenda\s+)?item\s+\w+[.:)]?\s*/i, "").trim();
  const parts = t.split(/\s[-\u2014\u2013]\s|:\s/);
  return parts.find((p) => NOUN.test(p)) ?? parts[0];
}

function capitalizedPhrase(text: string): string | undefined {
  const re = /\b((?:[A-Z][\w'&-]*|\d+)(?:\s+(?:of|and|&|at|on|to|the|No\.)?\s*(?:[A-Z][\w'&-]*|\d+))+)/g;
  for (const m of text.matchAll(re)) {
    const phrase = m[1].replace(/^(The|Council|Board|Staff|Motion|Commissioner|Director|Mayor|City|Town|County)\s+/i, "");
    if (NOUN.test(phrase) && phrase.split(/\s+/).length >= 2) return phrase;
  }
  return undefined;
}

const TIMING_RE = /\bFY\s?20\d\d\b|\b(?:Spring|Summer|Fall|Autumn|Winter)\s+20\d\d\b|\bQ[1-4]\s+20\d\d\b|\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+20\d\d\b/i;

function truncWords(s: string, n: number): string {
  const w = s.replace(/\s+/g, " ").trim().split(" ");
  return w.length <= n ? w.join(" ") : `${w.slice(0, n).join(" ")}...`;
}

interface Unit {
  text: string;
  heading?: string;
  isRow: boolean;
}

function toUnits(pageText: string): Unit[] {
  const units: Unit[] = [];
  let heading: string | undefined;
  let buf: string[] = [];
  const flush = () => {
    if (buf.length) units.push({ text: buf.join(" ").replace(/\s+/g, " ").trim(), heading, isRow: false });
    buf = [];
  };
  const lines = pageText.split("\n");
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return flush();
    if (/^#+\s/.test(line)) {
      flush();
      heading = cleanHeading(line);
      return;
    }
    if (line.startsWith("|")) {
      flush();
      const next = (lines[i + 1] ?? "").trim();
      if (/^\|[\s:|-]+\|?$/.test(line) || /^\|[\s:|-]+\|?$/.test(next)) return; // separator or header row
      units.push({ text: line, heading, isRow: true });
      return;
    }
    buf.push(line);
  });
  flush();
  return units;
}

export function mockExtractSignals(pageText: string, kind: string, page: number): ExtractedSignal[] {
  if (kind === "addendum") return [];
  if (kind === "solicitation" && page !== 1) return [];
  const out: ExtractedSignal[] = [];
  for (const u of toUnits(pageText)) {
    if (!CUE.test(u.text) || !NOUN.test(u.text)) continue;
    let title: string | undefined;
    if (u.isRow) title = u.text.split("|").map((c) => c.trim()).filter(Boolean)[0];
    else if (u.heading && NOUN.test(u.heading)) title = u.heading;
    title ??= capitalizedPhrase(u.text);
    title ??= u.text.split(/\s+/).slice(0, 8).join(" ");
    const body = u.isRow ? u.text.replace(/^\|\s*|\s*\|$/g, "") : u.text;
    const sents = sentences(body);
    const quote = (sents.find((s) => CUE.test(s)) ?? sents[0] ?? body).slice(0, 300);
    const money = parseMoney(u.text);
    const timing = u.text.match(TIMING_RE)?.[0];
    const stageText = kind === "solicitation" ? `${u.text} RFP` : u.text;
    out.push({
      projectTitle: title.slice(0, 120),
      category: mockCategory(`${title} ${u.text}`),
      stage: mockStage(stageText),
      estimatedValue: money?.amount ?? null,
      valueText: money?.text ?? null,
      timing: timing ?? null,
      summary: truncWords(u.isRow ? u.text.replace(/\|/g, " ").replace(/\s+/g, " ") : u.text, 40),
      evidenceQuote: quote,
      confidence: money ? 0.8 : 0.7,
    });
    if (kind === "solicitation") break;
  }
  return out;
}

// ---------- requirements ----------
export function mockExtractRequirements(pageText: string): RawRequirement[] {
  const text = pageText
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
  const out: RawRequirement[] = [];
  for (const s of sentences(text)) {
    if (!REQ_CUE.test(s) || s.length < 15) continue;
    const quote = s.slice(0, 300);
    out.push({ text: truncWords(s, 40), kind: classifyRequirement(s), quote });
  }
  return out;
}

// ---------- Q&A ----------
const STOP = new Set(
  "a an and are as at be by can do does for from has have how i if in is it its of on or our shall should that the their there this to was we what when where which who will with would you your".split(" "),
);
export function qTokens(q: string): string[] {
  return [...new Set(q.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t && !STOP.has(t)).map(stem))];
}
function stem(t: string): string {
  return t.length > 3 ? t.replace(/(ies|es|s)$/, "") : t;
}

export function mockAnswer(question: string, chunks: Chunk[]): Answer {
  const tokens = qTokens(question);
  const NOT_FOUND: Answer = { answer: "Not found in this document.", citations: [] };
  if (!tokens.length || !chunks.length) return NOT_FOUND;
  const need = Math.max(1, Math.ceil(tokens.length / 2));
  const cands: { s: string; page: number; documentId: string; score: number; order: number }[] = [];
  let order = 0;
  for (const c of chunks) {
    for (const s of sentences(c.text)) {
      const words = new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).map(stem));
      const score = tokens.filter((t) => words.has(t)).length;
      if (score >= need) cands.push({ s: s.slice(0, 300), page: c.page, documentId: c.documentId, score, order: order++ });
      else order++;
    }
  }
  if (!cands.length) return NOT_FOUND;
  cands.sort((a, b) => b.score - a.score || a.order - b.order);
  const top = cands.filter((c) => c.score === cands[0].score).slice(0, 2);
  return {
    answer: top.map((c) => `${truncWords(c.s, 45)} [p.${c.page}]`).join(" "),
    citations: top.map((c) => ({ page: c.page, quote: c.s, documentId: c.documentId })),
  };
}

// ---------- changes ----------
const CHANGE_CUE = /\b(revised|changed?|extended|replace[sd]?|delete[sd]?|add(?:s|ed)?)\b/i;

export function classifyChange(s: string): ChangeField {
  const dates = findDates(s);
  if (/question/i.test(s) && (dates.length || /deadline/i.test(s))) return "questions_deadline";
  if (/\b(due|deadline)\b/i.test(s) && dates.length) return "due_date";
  if (/\bbond\b/i.test(s)) return "bond";
  if (/quantity|additional|\bsecond\b|\badd(?:s|ed)?\b/i.test(s)) return "quantity";
  if (/spec|valve|\bC\d{3}\b|conform/i.test(s)) return "spec";
  return "other";
}

export function mockExtractChanges(pageText: string, page: number): Change[] {
  const out: Change[] = [];
  for (const s of sentences(pageText.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n"))) {
    if (!CHANGE_CUE.test(s)) continue;
    const field = classifyChange(s);
    const dates = findDates(s);
    let before: string | undefined;
    let after: string | undefined;
    if (field === "due_date" || field === "questions_deadline") {
      if (dates.length >= 2) {
        before = dates[0];
        after = dates[dates.length - 1];
      } else after = dates[0];
    } else {
      const m = s.match(/from\s+(.+?)\s+to\s+(.+?)(?:[.;]|$)/i);
      if (m) {
        before = m[1];
        after = m[2];
      }
    }
    out.push({ field, before, after, summary: truncWords(s, 40), page, quote: s.slice(0, 300) });
  }
  return out;
}

// ---------- tasks & letter ----------
export function mockSuggestTasks(reqs: Requirement[]): { title: string; page?: number }[] {
  return reqs
    .filter((r) => (r.kind === "certification" || r.kind === "bond") && r.meetsProfile !== "yes")
    .slice(0, 3)
    .map((r) => ({
      title: r.kind === "bond" ? `Confirm bonding with surety: ${truncWords(r.text, 12)}` : `Provide documentation: ${truncWords(r.text, 12)}`,
      page: r.page,
    }));
}

export const mockLLM: LLM = {
  mode: "mock",
  model: "mock-heuristics",
  async extractSignals({ page, text, doc }) {
    return mockExtractSignals(text, doc.kind, page);
  },
  async writeFitRationale({ profile, breakdown, matchedKeywords, category }) {
    return templateRationale(profile, breakdown, matchedKeywords, category);
  },
  async extractRequirements({ text }) {
    return mockExtractRequirements(text);
  },
  async answerQuestion({ question, chunks }) {
    return mockAnswer(question, chunks);
  },
  async suggestTasks({ requirements }) {
    return mockSuggestTasks(requirements);
  },
  async draftLetter({ profile, agencyName, pursuitTitle, requirements }) {
    const words = new Set(pursuitTitle.toLowerCase().split(/\W+/));
    const ranked = [...profile.pastBids]
      .map((b) => ({ b, s: b.title.toLowerCase().split(/\W+/).filter((w) => words.has(w)).length + (b.outcome === "won" ? 0.5 : 0) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 2)
      .map((x) => x.b);
    const met = requirements.filter((r) => r.meetsProfile === "yes").slice(0, 3);
    const open = requirements.filter((r) => r.meetsProfile !== "yes" && (r.kind === "certification" || r.kind === "bond")).slice(0, 2);
    const lead = profile.team[0];
    const lines = [
      `Dear ${agencyName} Selection Committee,`,
      `${profile.name} is pleased to submit this capability statement for ${pursuitTitle}. ${truncWords(profile.description, 45)}`,
      ranked.length
        ? `Relevant experience: ${ranked.map((b) => `${b.title} for ${b.agency} (${b.year}, ${b.outcome}) - ${truncWords(b.summary, 18)}`).join("; ")}.`
        : "",
      profile.certifications.length ? `We hold ${profile.certifications.join(", ")}.` : "",
      met.length ? `Against your stated requirements we confirm: ${met.map((r) => `${truncWords(r.text, 12)} (p.${r.page})`).join("; ")}.` : "",
      open.length ? `We will provide supporting documentation for: ${open.map((r) => `${truncWords(r.text, 10)} (p.${r.page})`).join("; ")}.` : "",
      profile.bondingCapacity ? `Our bonding capacity is ${formatMoney(profile.bondingCapacity)}.` : "",
      `We would welcome the opportunity to support ${agencyName} and are available to answer any questions before the bid date.`,
      lead ? `Sincerely,\n${lead.name}, ${lead.role}\n${profile.name}` : `Sincerely,\n${profile.name}`,
    ];
    return lines.filter(Boolean).join("\n\n");
  },
  async extractChanges({ text, page }) {
    return mockExtractChanges(text, page);
  },
};

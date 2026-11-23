import type { Profile, ReqKind, Requirement, KeyFields, DocPage } from "./types";
import type { RawRequirement } from "./schemas";
import { findDates, findTime, newId, parseMoney, sentences } from "./util";

export const REQ_CUE = /\b(due|deadline|bond|bonds|insurance|certif\w*|AWWA|ASTM|NSF|experience|years|submit|copies|pre-bid)\b/i;

export function classifyRequirement(s: string): ReqKind {
  if (/\bbonds?\b/i.test(s)) return "bond";
  if (/\binsurance\b/i.test(s)) return "insurance";
  if (/certif|AWWA|ASTM|NSF|UL\s?\d|\bAWS\b|\bDBE\b/i.test(s)) return "certification";
  if (/experience|\byears\b/i.test(s)) return "experience";
  if (/pre-bid|\bdue\b|deadline/i.test(s)) return "deadline";
  if (/submit|copies|sealed|envelope/i.test(s)) return "submission";
  return "other";
}

const KNOWN_TOKENS = ["AWWA", "NSF", "ASTM", "UL", "DBE", "AWS", "ISO", "ANSI", "API", "ASME", "IEEE"];

function standardTokens(text: string): string[] {
  return KNOWN_TOKENS.filter((t) => new RegExp(`\\b${t}\\b`).test(text));
}

export interface EvalContext {
  engineersEstimate?: number;
}

/** Deterministic rules: does the company profile satisfy this requirement? */
export function evaluateRequirement(
  req: Pick<Requirement, "text" | "kind" | "quote">,
  profile: Profile,
  ctx: EvalContext = {},
): { meetsProfile: Requirement["meetsProfile"]; note: string } {
  const text = `${req.text} ${req.quote}`;
  if (req.kind === "certification") {
    const tokens = standardTokens(text);
    if (!tokens.length) return { meetsProfile: "unknown", note: "No recognised standard named; verify manually." };
    const certs = profile.certifications.join(" ");
    const missing = tokens.filter((t) => !new RegExp(`\\b${t}\\b`, "i").test(certs));
    if (!missing.length) return { meetsProfile: "yes", note: `Profile lists ${tokens.join(", ")}.` };
    return { meetsProfile: "no", note: `Profile does not list ${missing.join(", ")}.` };
  }
  if (req.kind === "bond") {
    if (profile.bondingCapacity === undefined) return { meetsProfile: "unknown", note: "No bonding capacity on profile." };
    const pct = text.match(/(\d{1,3}(?:\.\d+)?)\s?(?:%|percent)/i);
    const dollars = parseMoney(text);
    let amount: number | undefined;
    if (dollars) amount = dollars.amount;
    else if (pct && ctx.engineersEstimate) amount = (parseFloat(pct[1]) / 100) * ctx.engineersEstimate;
    if (amount === undefined) return { meetsProfile: "unknown", note: "Bond amount cannot be determined (no estimate stated)." };
    return amount <= profile.bondingCapacity
      ? { meetsProfile: "yes", note: `About $${Math.round(amount).toLocaleString()} is within the $${profile.bondingCapacity.toLocaleString()} bonding capacity.` }
      : { meetsProfile: "no", note: `About $${Math.round(amount).toLocaleString()} exceeds the $${profile.bondingCapacity.toLocaleString()} bonding capacity.` };
  }
  if (req.kind === "other" || req.kind === "spec") {
    const tokens = standardTokens(text);
    if (tokens.length) return evaluateRequirement({ ...req, kind: "certification" }, profile, ctx);
  }
  return { meetsProfile: "unknown", note: "" };
}

export function buildRequirements(
  raws: { raw: RawRequirement; page: number; documentId?: string }[],
  profile: Profile,
  ctx: EvalContext,
): Requirement[] {
  const seen = new Set<string>();
  const out: Requirement[] = [];
  for (const { raw, page, documentId } of raws) {
    const key = `${documentId ?? ""}|${raw.text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const ev = evaluateRequirement(raw, profile, ctx);
    out.push({ id: newId("req"), text: raw.text, kind: raw.kind, page, quote: raw.quote, documentId, ...ev });
  }
  return out;
}

/** Deterministic extraction of the key facts shown at the top of a solicitation. */
export function extractKeyFields(pages: DocPage[]): KeyFields {
  const kf: KeyFields = {};
  for (const p of pages) {
    for (const s of sentences(p.text)) {
      const dates = findDates(s);
      const time = findTime(s);
      const field = (extra?: object) => ({
        value: [dates[0] ? s.match(/[A-Z][a-z]+\.?\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2}/)?.[0] : undefined, time].filter(Boolean).join(" "),
        iso: dates[0],
        page: p.n,
        quote: s.slice(0, 300),
        ...extra,
      });
      if (!kf.questionsDeadline && /question/i.test(s) && dates.length && /\b(due|deadline|no later|by)\b/i.test(s)) kf.questionsDeadline = field();
      else if (!kf.preBid && /pre-?bid/i.test(s) && dates.length) kf.preBid = field();
      else if (!kf.bidDue && /\b(bids?|proposals?|submissions?)\b[^.]*\b(due|received|deadline)\b/i.test(s) && dates.length) kf.bidDue = field();
      if (!kf.bidBond && /bid bond/i.test(s)) {
        const m = s.match(/(\d{1,2}(?:\.\d+)?)\s?(?:%|percent)/i);
        if (m) kf.bidBond = { value: `${m[1]}%`, page: p.n, quote: s.slice(0, 300) };
      }
      if (!kf.engineersEstimate && /engineer'?s'? (?:opinion|estimate)/i.test(s)) {
        const money = parseMoney(s);
        if (money) kf.engineersEstimate = { value: money.text, amount: money.amount, page: p.n, quote: s.slice(0, 300) };
      }
    }
  }
  return kf;
}

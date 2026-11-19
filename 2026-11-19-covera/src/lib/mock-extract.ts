import { industries } from "./data";
import type { Line, RiskProfile } from "./types";

const REF_YEAR = 2026;

const WORD_NUMS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function parseMoney(num: string, suffix?: string): number | undefined {
  const cleaned = num.replace(/,/g, "").replace(/[.]+$/, "");
  const n = parseFloat(cleaned);
  if (Number.isNaN(n)) return undefined;
  const s = (suffix ?? "").toLowerCase();
  if (s === "k" || s === "thousand") return Math.round(n * 1_000);
  if (s === "m" || s === "million") return Math.round(n * 1_000_000);
  return Math.round(n);
}

const SUFFIX = "(k|m|thousand|million)?";

function findMoney(text: string, keywords: string): number | undefined {
  const before = new RegExp(`\\$\\s?([\\d][\\d.,]*)\\s*${SUFFIX}\\s*(?:in\\s+|of\\s+)?(?:annual\\s+|gross\\s+|annualized\\s+)?(?:${keywords})\\b`, "i");
  const after = new RegExp(`\\b(?:${keywords})\\b[^$\\d\\n.]{0,25}\\$\\s?([\\d][\\d.,]*)\\s*${SUFFIX}`, "i");
  const m = before.exec(text) ?? after.exec(text);
  return m ? parseMoney(m[1], m[2]) : undefined;
}

function sentences(text: string): string[] {
  return text
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function extractBusinessName(text: string, lines: string[]): { name?: string; tail?: string } {
  const re = /\b(?:[Ww]e are|[Ww]e're|[Tt]his is)\s+([A-Z][\w&'’\- ]*?)(?=,|\.(?:\s|$)| is | are | an? | at | located| based)(.*)/;
  const m = re.exec(text);
  if (m) return { name: m[1].trim(), tail: m[2] };
  for (const l of lines) {
    const sig = /^(?:Owner|President|Manager|Founder|Co-?founder|CEO|Principal|Director|Partner)\s*[,\-–]\s*(.+)$/i.exec(l.trim());
    if (sig) return { name: sig[1].trim() };
  }
  const subj = /^Subject:.*?\s-\s(.+)$/im.exec(text);
  if (subj) return { name: subj[1].trim() };
  return {};
}

function extractContactName(lines: string[]): string | undefined {
  for (let i = 0; i < lines.length; i++) {
    if (/^(thanks|thank you|best|best regards|regards|sincerely|cheers|many thanks)[,!.]*$/i.test(lines[i].trim())) {
      for (let j = i + 1; j < lines.length; j++) {
        const cand = lines[j].trim();
        if (!cand) continue;
        if (/^[A-Z][\w.'’-]+(?: [A-Z][\w.'’-]+){1,3}$/.test(cand)) return cand;
        return undefined;
      }
    }
  }
  return undefined;
}

function extractAddress(text: string): RiskProfile["address"] | undefined {
  const full =
    /(\d{1,6}(?:\s+[A-Za-z0-9.'#-]+){1,5}),\s*([A-Za-z][A-Za-z .'-]*?),\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?\b/.exec(text);
  if (full) {
    return { street: full[1].trim(), city: full[2].trim(), state: full[3], zip: full[4] };
  }
  const sz = /\b([A-Z]{2})\s+(\d{5})(?:-\d{4})?\b/.exec(text);
  if (sz) return { state: sz[1], zip: sz[2] };
  return undefined;
}

function extractIndustry(text: string): string | undefined {
  const lower = text.toLowerCase();
  let best: { id: string; score: number } | undefined;
  for (const ind of industries) {
    let score = 0;
    for (const kw of ind.keywords) {
      const re = new RegExp(`\\b${kw.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g");
      score += (lower.match(re) ?? []).length;
    }
    if (score > 0 && (!best || score > best.score)) best = { id: ind.id, score };
  }
  return best?.id;
}

function extractLines(text: string): Line[] {
  const out: Line[] = [];
  if (/\bBOP\b|business\s*owner'?s?\s+policy/i.test(text)) out.push("bop");
  if (/general\s+liability|\bGL\b/i.test(text)) out.push("gl");
  if (/workers'?\s*comp|\bWC\b/i.test(text)) out.push("wc");
  if (/commercial\s+auto|business\s+auto|\bauto\b(?!\s+(?:repair|body|shop|mechanic))/i.test(text)) out.push("auto");
  if (/cyber/i.test(text)) out.push("cyber");
  if (/liquor|dram\s+shop/i.test(text)) out.push("liquor");
  return out;
}

function extractDate(text: string): string | undefined {
  const iso = /effective(?:\s+date)?[:\s]+(?:on\s+)?(\d{4}-\d{2}-\d{2})/i.exec(text);
  if (iso) return iso[1];
  const named = /effective(?:\s+date)?[:\s]+(?:on\s+)?([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i.exec(text);
  if (named) {
    const mi = MONTHS.indexOf(named[1].slice(0, 3).toLowerCase());
    if (mi >= 0) return `${named[3]}-${String(mi + 1).padStart(2, "0")}-${named[2].padStart(2, "0")}`;
  }
  const us = /effective(?:\s+date)?[:\s]+(?:on\s+)?(\d{1,2})\/(\d{1,2})\/(\d{4})/i.exec(text);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  return undefined;
}

function toCount(token: string): number {
  const t = token.toLowerCase();
  return WORD_NUMS[t] ?? parseInt(t, 10);
}

/** Deterministic regex/keyword extractor used in mock mode. Same input always yields the same profile. */
export function mockExtractRiskProfile(text: string): RiskProfile {
  const lines = text.split(/\r?\n/);
  const profile: RiskProfile = { requestedLines: extractLines(text) };

  const { name, tail } = extractBusinessName(text, lines);
  if (name) profile.businessName = name;
  const contact = extractContactName(lines);
  if (contact) profile.contactName = contact;
  const email = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/.exec(text);
  if (email) profile.contactEmail = email[0];

  const desc =
    /\b(?:[Ww]e are|[Ww]e're)\s+(an?\s[^.]+?)(?=\s+(?:at|located)\s+\d|[.]|$)/.exec(text) ??
    (tail ? /,\s*(an?\s[^.,]+?)(?=\s+(?:at|located)\s+\d|\.|,|$)/.exec(tail) : null);
  if (desc) profile.description = desc[1].trim();

  const address = extractAddress(text);
  if (address) profile.address = address;

  const industry = extractIndustry(text);
  if (industry) {
    profile.industry = industry;
    profile.classCode = industries.find((i) => i.id === industry)?.classCode;
  }

  const years =
    /(\d+)\s*\+?\s*years?\s+in\s+business/i.exec(text) ??
    /in\s+business\s+(?:for\s+)?(\d+)\s+years?/i.exec(text);
  if (years) profile.yearsInBusiness = parseInt(years[1], 10);
  else {
    const since = /\b(?:since|established(?:\s+in)?|founded(?:\s+in)?)\s+(19\d{2}|20\d{2})\b/i.exec(text);
    if (since) profile.yearsInBusiness = REF_YEAR - parseInt(since[1], 10);
  }

  const revenue = findMoney(text, "revenue|sales");
  if (revenue !== undefined) profile.annualRevenue = revenue;
  const payroll = findMoney(text, "payroll");
  if (payroll !== undefined) profile.annualPayroll = payroll;

  const emp =
    /(\d+)\s+(?:full[- ]time\s+|part[- ]time\s+)?(?:employees|staff|workers|team members|FTEs?)\b/i.exec(text) ??
    /employees\s*[:=]\s*(\d+)/i.exec(text);
  if (emp) profile.employees = parseInt(emp[1], 10);

  const building: NonNullable<RiskProfile["building"]> = {};
  const sqft = /([\d][\d,]*)\s*(?:sq\.?\s?ft\.?|square\s+(?:feet|foot)|sqft)\b/i.exec(text);
  if (sqft) building.squareFeet = parseInt(sqft[1].replace(/,/g, ""), 10);
  const built = /built\s+in\s+(\d{4})|year\s+built\s*:?\s*(\d{4})/i.exec(text);
  if (built) building.yearBuilt = parseInt(built[1] ?? built[2], 10);
  if (/not\s+sprinklered|no\s+sprinklers?|unsprinklered/i.test(text)) building.sprinklered = false;
  else if (/sprinklered|sprinkler\s+system|sprinklers/i.test(text)) building.sprinklered = true;
  if (/\bwe\s+own\b|\bowned\s+building\b|\bown\s+the\s+building\b/i.test(text)) building.owned = true;
  else if (/\b(?:lease|leases|leased|rent|rents|renting)\b/i.test(text)) building.owned = false;
  if (Object.keys(building).length) profile.building = building;

  const veh = /(\d+)\s+(?:company\s+)?(?:vehicles|trucks|vans|pickups|cars|power\s+units|tractors)\b/i.exec(text);
  if (veh) profile.vehicles = parseInt(veh[1], 10);

  const sents = sentences(text);
  if (/claim/i.test(text)) {
    const none = /\b(?:no|zero|0)\s+(?:prior\s+|previous\s+|recent\s+)?(?:claims|losses)/i.test(text);
    const num = /\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:prior\s+|previous\s+|recent\s+)?claims?\b/i.exec(text);
    const count = none ? 0 : num ? toCount(num[1]) : 1;
    const notes = sents.filter((s) => /claim/i.test(s)).join(" ");
    profile.priorClaims = { count, ...(notes ? { notes } : {}) };
  }

  const liquorNotes = sents.filter((s) => /liquor|alcohol/i.test(s) && /\d+(?:\.\d+)?\s*(?:%|percent)/i.test(s));
  if (liquorNotes.length) profile.notes = liquorNotes.join(" ");

  const date = extractDate(text);
  if (date) profile.effectiveDate = date;

  return profile;
}

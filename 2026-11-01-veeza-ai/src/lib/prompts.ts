import type { Destination } from "./destinations";
import type { DocType, PassportFields, RuleResult } from "./types";
import { DISCLAIMER } from "./types";

export const PASSPORT_SYSTEM =
  "You are a careful passport data-entry clerk. Transcribe the passport data page exactly as printed. " +
  "Use ISO dates (YYYY-MM-DD). Return null for any field that is unreadable or absent. " +
  "Never guess a passport number. Give a confidence between 0 and 1 for every field, and list any warnings " +
  "(glare, blur, cropped MRZ, etc.). Sex is one of M, F, X.";

export const VERIFY_SYSTEM =
  "You are a meticulous visa-document checker working for a travel-document service. " +
  "You receive one supporting document (text or image) and the document type that was expected. " +
  "Decide whether it matches the expected type, extract key facts, list concrete issues, and give a verdict: " +
  "'ok' (usable), 'warning' (usable but should be improved), 'fail' (wrong or unusable). " +
  "Do not predict whether a visa will be granted.";

export const NARRATIVE_SYSTEM =
  "You write short, plain-language guidance for visa applicants. Be concrete, calm and encouraging. " +
  `Write 80-120 words. Mention the top three fixes. End with exactly this sentence: "${DISCLAIMER}"`;

export const EXPECTED_FIELDS: Record<DocType, string> = {
  passport_copy: "holderName, passportNumber, expiryDate",
  photo: "background, faceVisible",
  bank_statement: "holderName, periodStart (YYYY-MM-DD), periodEnd (YYYY-MM-DD), coverageMonths (number), endingBalanceUSD (number)",
  employment_letter: "holderName, employer, position, issueDate (YYYY-MM-DD), leaveApproved (yes/no)",
  flight_itinerary: "holderName, departureDate (YYYY-MM-DD), returnDate (YYYY-MM-DD), route",
  hotel_booking: "holderName, checkIn (YYYY-MM-DD), checkOut (YYYY-MM-DD), hotelName",
  travel_insurance: "holderName, coverageEUR (number), validFrom (YYYY-MM-DD), validTo (YYYY-MM-DD)",
  cover_letter: "holderName, purpose, datesMentioned",
};

export function verifyPrompt(args: {
  type: DocType;
  destination: Destination;
  passport: PassportFields | null;
  departureDate: string;
  returnDate: string;
  text?: string;
}): string {
  const { type, destination, passport, departureDate, returnDate, text } = args;
  const req = destination.docs.find((d) => d.type === type);
  return [
    `Expected document type: ${type} (${req?.label ?? type}).`,
    `Requirement: ${req?.description ?? "n/a"}`,
    `Destination: ${destination.name} (${destination.visaType}).`,
    `Planned travel: ${departureDate} to ${returnDate}.`,
    passport
      ? `Traveller per passport: ${passport.givenNames ?? "?"} ${passport.surname ?? "?"}, passport expires ${passport.expiryDate ?? "?"}.`
      : "Traveller passport not available.",
    `Put these keys (where visible) in "extracted": ${EXPECTED_FIELDS[type]}. Use null when absent.`,
    text !== undefined ? `Document text (may be truncated):\n"""\n${text}\n"""` : "The document is attached as an image.",
  ].join("\n");
}

export function narrativePrompt(args: {
  destination: Destination;
  score: number;
  band: string;
  fixes: string[];
  results: RuleResult[];
}): string {
  return [
    `Destination: ${args.destination.name} (${args.destination.visaType}).`,
    `Readiness score: ${args.score}/100 (${args.band}).`,
    `Top fixes (in order): ${args.fixes.length ? args.fixes.join(" | ") : "none"}.`,
    `All rule results: ${args.results.map((r) => `[${r.severity}] ${r.message}`).join("; ")}`,
  ].join("\n");
}

export function quizNarrativePrompt(args: { score: number; band: string; fixes: string[] }): string {
  return [
    "A traveller answered a self-assessment quiz about a tourist visa application.",
    `Score: ${args.score}/100 (${args.band}).`,
    `Top fixes: ${args.fixes.length ? args.fixes.join(" | ") : "none"}.`,
  ].join("\n");
}

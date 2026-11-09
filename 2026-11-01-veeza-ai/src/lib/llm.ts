import { createAnthropic } from "@ai-sdk/anthropic";
import { generateObject, generateText } from "ai";
import { z } from "zod";
import type { Destination } from "./destinations";
import {
  NARRATIVE_SYSTEM, PASSPORT_SYSTEM, VERIFY_SYSTEM,
  narrativePrompt, quizNarrativePrompt, verifyPrompt,
} from "./prompts";
import {
  DISCLAIMER, PASSPORT_KEYS,
  type DocType, type PassportConfidence, type PassportFields, type RuleResult, type Verification,
} from "./types";

let warned = false;
export function isMock(): boolean {
  const mock = process.env.MOCK_LLM === "1" || !process.env.ANTHROPIC_API_KEY;
  if (mock && !warned) {
    warned = true;
    console.warn("[llm] MOCK mode active (MOCK_LLM=1 or ANTHROPIC_API_KEY missing): returning canned outputs.");
  }
  return mock;
}

function model() {
  const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropic(process.env.LLM_MODEL || "claude-sonnet-4-5");
}

export interface ImageInput { data: Buffer; mediaType: string }
export type FileInput = { text: string } | { image: ImageInput };

// ---------- Schemas ----------

const nullableStr = z.string().nullable();
export const passportSchema = z.object({
  fields: z.object({
    surname: nullableStr,
    givenNames: nullableStr,
    passportNumber: nullableStr,
    nationality: nullableStr,
    dateOfBirth: nullableStr.describe("ISO YYYY-MM-DD"),
    sex: nullableStr,
    issueDate: nullableStr.describe("ISO YYYY-MM-DD"),
    expiryDate: nullableStr.describe("ISO YYYY-MM-DD"),
    issuingAuthority: nullableStr,
    mrzLine1: nullableStr,
    mrzLine2: nullableStr,
  }),
  confidence: z.object(Object.fromEntries(PASSPORT_KEYS.map((k) => [k, z.number().min(0).max(1)])) as Record<(typeof PASSPORT_KEYS)[number], z.ZodNumber>),
  warnings: z.array(z.string()),
});
export type PassportExtraction = { fields: PassportFields; confidence: PassportConfidence; warnings: string[] };

export const verificationSchema = z.object({
  matchesExpectedType: z.boolean(),
  extracted: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
  issues: z.array(z.string()),
  verdict: z.enum(["ok", "warning", "fail"]),
});

// ---------- Mock data ----------

export const MOCK_PASSPORT: PassportFields = {
  surname: "ELSAYED",
  givenNames: "AHMED MOHAMED",
  passportNumber: "A12345678",
  nationality: "EGY",
  dateOfBirth: "1990-05-14",
  sex: "M",
  issueDate: "2023-03-01",
  expiryDate: "2030-02-28",
  issuingAuthority: "Ministry of Interior, Cairo",
  mrzLine1: "P<EGYELSAYED<<AHMED<MOHAMED<<<<<<<<<<<<<<<<<<",
  mrzLine2: "A123456784EGY9005148M3002285<<<<<<<<<<<<<<04",
};

function mockPassport(): PassportExtraction {
  const confidence = Object.fromEntries(
    PASSPORT_KEYS.map((k) => [k, k === "mrzLine1" || k === "mrzLine2" ? 0.82 : 0.95]),
  ) as PassportConfidence;
  return { fields: { ...MOCK_PASSPORT }, confidence, warnings: ["Mock mode: canned sample passport returned for every upload."] };
}

function mockVerification(type: DocType, ctx: { departureDate: string; returnDate: string }): Verification {
  const name = "AHMED MOHAMED ELSAYED";
  const extracted: Record<DocType, Record<string, string | number | null>> = {
    passport_copy: { holderName: name, passportNumber: "A12345678", expiryDate: "2030-02-28" },
    photo: { background: "white", faceVisible: "yes" },
    bank_statement: {
      holderName: name, periodStart: "2026-05-01", periodEnd: "2026-10-31", coverageMonths: 6, endingBalanceUSD: 4200,
    },
    employment_letter: {
      holderName: name, employer: "Nile Software LLC", position: "Software Engineer", issueDate: "2026-10-15", leaveApproved: "yes",
    },
    flight_itinerary: {
      holderName: name, departureDate: ctx.departureDate, returnDate: ctx.returnDate, route: "CAI-ZAG-CAI",
    },
    hotel_booking: {
      holderName: name, checkIn: ctx.departureDate, checkOut: ctx.returnDate, hotelName: "Hotel Example Zagreb",
    },
    travel_insurance: {
      holderName: name, coverageEUR: 50000, validFrom: ctx.departureDate, validTo: ctx.returnDate,
    },
    cover_letter: { holderName: name, purpose: "Tourism", datesMentioned: `${ctx.departureDate} to ${ctx.returnDate}` },
  };
  return { matchesExpectedType: true, extracted: extracted[type], issues: [], verdict: "ok" };
}

function mockNarrative(args: { score: number; band: string; fixes: string[]; subject: string }): string {
  const fixList = args.fixes.length
    ? args.fixes.slice(0, 3).map((f, i) => `${i + 1}) ${f}`).join(" ")
    : "Nothing urgent stands out; keep your papers consistent with each other.";
  return (
    `Your ${args.subject} scores ${args.score} out of 100, which we label ${args.band}. ` +
    `This number comes from simple rules about missing papers, warnings and passport validity, so you can see exactly what moves it. ` +
    `The most useful fixes right now: ${fixList} ` +
    `Take the time to double-check names, dates and amounts so every document tells the same story, and confirm the current requirements ` +
    `with the embassy or visa centre before you submit anything. ${DISCLAIMER}`
  );
}

// ---------- Helpers ----------

function ensureDisclaimer(text: string): string {
  const t = text.trim();
  return t.endsWith(DISCLAIMER) ? t : `${t} ${DISCLAIMER}`;
}

function userContent(prompt: string, input: FileInput) {
  if ("image" in input) {
    return [
      { type: "text" as const, text: prompt },
      { type: "image" as const, image: input.image.data, mediaType: input.image.mediaType },
    ];
  }
  return [{ type: "text" as const, text: prompt }];
}

// ---------- Public helpers ----------

export async function extractPassport(input: FileInput): Promise<PassportExtraction> {
  if (isMock()) return mockPassport();
  const prompt =
    "Extract the passport data page fields." +
    ("text" in input ? `\nText extracted from the PDF:\n"""\n${input.text.slice(0, 12000)}\n"""` : "");
  const { object } = await generateObject({
    model: model(),
    system: PASSPORT_SYSTEM,
    schema: passportSchema,
    messages: [{ role: "user", content: userContent(prompt, input) }],
  });
  return { fields: object.fields, confidence: object.confidence, warnings: object.warnings };
}

export interface VerifyContext {
  destination: Destination;
  passport: PassportFields | null;
  departureDate: string;
  returnDate: string;
}

export async function verifyDocument(type: DocType, input: FileInput, ctx: VerifyContext): Promise<Verification> {
  if (isMock()) return mockVerification(type, ctx);
  const text = "text" in input ? input.text.slice(0, 12000) : undefined;
  const prompt = verifyPrompt({ type, text, ...ctx });
  const { object } = await generateObject({
    model: model(),
    system: VERIFY_SYSTEM,
    schema: verificationSchema,
    messages: [{ role: "user", content: userContent(prompt, input) }],
  });
  return object;
}

export async function readinessNarrative(args: {
  destination: Destination; score: number; band: string; fixes: string[]; results: RuleResult[];
}): Promise<string> {
  if (isMock()) return mockNarrative({ ...args, subject: `${args.destination.name} application` });
  const { text } = await generateText({
    model: model(),
    system: NARRATIVE_SYSTEM,
    prompt: narrativePrompt(args),
  });
  return ensureDisclaimer(text);
}

export async function quizNarrative(args: { score: number; band: string; fixes: string[] }): Promise<string> {
  if (isMock()) return mockNarrative({ ...args, subject: "visa-readiness quiz result" });
  const { text } = await generateText({
    model: model(),
    system: NARRATIVE_SYSTEM,
    prompt: quizNarrativePrompt(args),
  });
  return ensureDisclaimer(text);
}

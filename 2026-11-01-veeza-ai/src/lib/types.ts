export const DOC_TYPES = [
  "passport_copy",
  "photo",
  "bank_statement",
  "employment_letter",
  "flight_itinerary",
  "hotel_booking",
  "travel_insurance",
  "cover_letter",
] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const STATUSES = ["draft", "documents", "prepared", "review", "appointment"] as const;
export type Status = (typeof STATUSES)[number];

export const PASSPORT_KEYS = [
  "surname",
  "givenNames",
  "passportNumber",
  "nationality",
  "dateOfBirth",
  "sex",
  "issueDate",
  "expiryDate",
  "issuingAuthority",
  "mrzLine1",
  "mrzLine2",
] as const;
export type PassportKey = (typeof PASSPORT_KEYS)[number];
export type PassportFields = Record<PassportKey, string | null>;
export type PassportConfidence = Record<PassportKey, number>;

export type Verdict = "ok" | "warning" | "fail";
export interface Verification {
  matchesExpectedType: boolean;
  extracted: Record<string, string | number | null>;
  issues: string[];
  verdict: Verdict;
}

export type Severity = "ok" | "warning" | "fail" | "missing";
export interface RuleResult {
  code: string;
  severity: Severity;
  message: string;
  docType?: DocType;
  travellerIndex?: number;
}

export type Band = "Strong" | "Needs work" | "Weak";

export const DISCLAIMER = "A guide, never a visa decision.";

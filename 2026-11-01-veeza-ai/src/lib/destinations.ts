import type { DocType } from "./types";

export const CATALOGUE_NOTE =
  "Requirements are illustrative and must be confirmed with the embassy/visa centre.";

export interface DocRequirement {
  type: DocType;
  label: string;
  description: string;
  /** "traveller" = one per traveller, "shared" = one per application. */
  scope: "traveller" | "shared";
}

export interface DestinationRules {
  bankStatementMonths: number;
  insuranceMinCoverEUR?: number;
  passportValidityMonthsAfterDeparture: number;
  passportMaxAgeYears: number;
  photoSpec: string;
}

export interface Destination {
  code: string;
  name: string;
  visaType: string;
  schengen: boolean;
  formStyle: "schengen" | "uk" | "us";
  docs: DocRequirement[];
  rules: DestinationRules;
  /** Illustrative per-person service fee in USD (NOT Veeza's pricing). */
  feeUSD: number;
  note: string;
}

const D = {
  passport_copy: (): DocRequirement => ({
    type: "passport_copy",
    label: "Passport copy",
    description: "Data page of the passport (extracted in the Travellers tab).",
    scope: "traveller",
  }),
  photo: (spec: string): DocRequirement => ({
    type: "photo",
    label: "Passport-style photo",
    description: spec,
    scope: "traveller",
  }),
  bank: (months: number): DocRequirement => ({
    type: "bank_statement",
    label: "Bank statement",
    description: `Recent statement covering at least the last ${months} months, in the traveller's name.`,
    scope: "traveller",
  }),
  employment: (): DocRequirement => ({
    type: "employment_letter",
    label: "Employment / student letter",
    description: "Letter from employer or university confirming position and approved leave.",
    scope: "traveller",
  }),
  flight: (): DocRequirement => ({
    type: "flight_itinerary",
    label: "Flight itinerary",
    description: "Return flight reservation matching the travel dates (a reservation, not a purchased ticket).",
    scope: "shared",
  }),
  hotel: (): DocRequirement => ({
    type: "hotel_booking",
    label: "Hotel booking",
    description: "Accommodation booking covering the whole stay.",
    scope: "shared",
  }),
  insurance: (min: number): DocRequirement => ({
    type: "travel_insurance",
    label: "Travel insurance",
    description: `Medical travel insurance with at least EUR ${min.toLocaleString("en-US")} cover, valid in all Schengen states.`,
    scope: "traveller",
  }),
  cover: (): DocRequirement => ({
    type: "cover_letter",
    label: "Cover letter",
    description: "Short letter explaining the purpose of the trip, dates and itinerary.",
    scope: "traveller",
  }),
};

const SCHENGEN_PHOTO = "35x45 mm, white background, face centred, taken within the last 6 months.";
const UK_PHOTO = "Recent colour photo, plain light background, no glasses.";
const US_PHOTO = "5x5 cm (2x2 in), white background, taken within the last 6 months.";

function schengen(code: string, name: string, feeUSD: number): Destination {
  return {
    code,
    name,
    visaType: "Schengen short-stay (Type C) tourist visa",
    schengen: true,
    formStyle: "schengen",
    docs: [
      D.passport_copy(),
      D.photo(SCHENGEN_PHOTO),
      D.bank(3),
      D.employment(),
      D.flight(),
      D.hotel(),
      D.insurance(30000),
      D.cover(),
    ],
    rules: {
      bankStatementMonths: 3,
      insuranceMinCoverEUR: 30000,
      passportValidityMonthsAfterDeparture: 3,
      passportMaxAgeYears: 10,
      photoSpec: SCHENGEN_PHOTO,
    },
    feeUSD,
    note: CATALOGUE_NOTE,
  };
}

export const DESTINATIONS: Destination[] = [
  schengen("HR", "Croatia", 119),
  schengen("FI", "Finland", 129),
  schengen("DK", "Denmark", 129),
  schengen("NO", "Norway", 139),
  schengen("SE", "Sweden", 129),
  schengen("EE", "Estonia", 119),
  schengen("MT", "Malta", 119),
  schengen("GR", "Greece", 119),
  {
    code: "GB",
    name: "United Kingdom",
    visaType: "UK Standard Visitor visa",
    schengen: false,
    formStyle: "uk",
    docs: [
      D.passport_copy(),
      D.photo(UK_PHOTO),
      D.bank(6),
      D.employment(),
      D.flight(),
      D.hotel(),
      D.cover(),
    ],
    rules: {
      bankStatementMonths: 6,
      passportValidityMonthsAfterDeparture: 0,
      passportMaxAgeYears: 10,
      photoSpec: UK_PHOTO,
    },
    feeUSD: 169,
    note: CATALOGUE_NOTE,
  },
  {
    code: "US",
    name: "United States",
    visaType: "US B1/B2 visitor visa (DS-160 style summary)",
    schengen: false,
    formStyle: "us",
    docs: [
      D.passport_copy(),
      D.photo(US_PHOTO),
      D.bank(6),
      D.employment(),
      D.flight(),
      D.cover(),
    ],
    rules: {
      bankStatementMonths: 6,
      passportValidityMonthsAfterDeparture: 6,
      passportMaxAgeYears: 10,
      photoSpec: US_PHOTO,
    },
    feeUSD: 199,
    note: CATALOGUE_NOTE,
  },
];

export function getDestination(code: string): Destination | undefined {
  return DESTINATIONS.find((d) => d.code === code.toUpperCase());
}

export const NATIONALITIES: { code: string; name: string }[] = [
  { code: "EG", name: "Egyptian" },
  { code: "JO", name: "Jordanian" },
  { code: "LB", name: "Lebanese" },
  { code: "MA", name: "Moroccan" },
  { code: "DZ", name: "Algerian" },
  { code: "TN", name: "Tunisian" },
  { code: "PK", name: "Pakistani" },
  { code: "BD", name: "Bangladeshi" },
  { code: "IN", name: "Indian" },
  { code: "NG", name: "Nigerian" },
  { code: "KE", name: "Kenyan" },
];

export function nationalityName(code: string): string {
  return NATIONALITIES.find((n) => n.code === code)?.name ?? code;
}

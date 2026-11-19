export type Line = "bop" | "gl" | "wc" | "auto" | "cyber" | "liquor";

export const LINES: Line[] = ["bop", "gl", "wc", "auto", "cyber", "liquor"];

export const LINE_LABELS: Record<Line, string> = {
  bop: "Business Owner's Policy (BOP)",
  gl: "General Liability",
  wc: "Workers' Compensation",
  auto: "Commercial Auto",
  cyber: "Cyber",
  liquor: "Liquor Liability",
};

export type RiskProfile = {
  businessName?: string;
  contactName?: string;
  contactEmail?: string;
  industry?: string;
  classCode?: string;
  description?: string;
  address?: { street?: string; city?: string; state?: string; zip?: string };
  yearsInBusiness?: number;
  annualRevenue?: number;
  annualPayroll?: number;
  employees?: number;
  building?: { squareFeet?: number; yearBuilt?: number; sprinklered?: boolean; owned?: boolean };
  vehicles?: number;
  priorClaims?: { count: number; notes?: string };
  requestedLines: Line[];
  effectiveDate?: string;
  notes?: string;
};

export type MissingItem = { line: Line | "general"; field: string; why: string };

export type Quote = {
  id: string;
  carrierId: string;
  carrierName: string;
  line: Line;
  status: "quoted" | "declined" | "needs_info";
  premium?: number;
  deductible?: number;
  limits?: Record<string, number>;
  coverages?: string[];
  exclusions?: string[];
  reason?: string;
  log: string[];
  createdAt: string;
};

export type Stage = "intake" | "needs_info" | "quoting" | "quoted" | "selected";
export const STAGES: Stage[] = ["intake", "needs_info", "quoting", "quoted", "selected"];

export type LineComparison = {
  line: Line;
  quoteIds: string[];
  cheapestQuoteId?: string;
  broadestQuoteId?: string;
  recommendedQuoteId?: string;
};

export type ComparisonDiff = {
  rows: {
    quoteId: string;
    carrierName: string;
    line: Line;
    premium: number;
    deductible?: number;
    limits: Record<string, number>;
    coverages: string[];
    exclusions: string[];
  }[];
  byLine: LineComparison[];
};

export type Opportunity = {
  id: string;
  createdAt: string;
  stage: Stage;
  sourceText: string;
  attachments: { filename: string; text: string }[];
  profile: RiskProfile;
  missing: MissingItem[];
  followUpEmail?: string;
  quotes: Quote[];
  comparison?: { summary: string; proposalEmail: string; recommendedQuoteId?: string; diff?: ComparisonDiff };
  selectedQuoteId?: string;
};

export type Account = {
  id: string;
  name: string;
  industry: string;
  state: string;
  employees: number;
  policies: { line: Line; carrier: string; premium: number; expiration: string }[];
};

export type Gap = { accountId: string; line: Line; reason: string; outreachEmail?: string };

export type Industry = {
  id: string;
  name: string;
  classCode: string;
  hazardGrade: number;
  recommendedLines: Line[];
  keywords: string[];
};

export type FieldType = "string" | "number" | "boolean";

export type CarrierField = { path: string; type: FieldType; required: boolean; forLines?: Line[] };

export type LineRating = {
  base: number;
  deductibleOptions: number[];
  limits: Record<string, number>;
  coverages: string[];
  exclusions: string[];
};

export type Carrier = {
  id: string;
  name: string;
  blurb: string;
  lines: Line[];
  fieldSchema: Record<string, CarrierField>;
  appetite: {
    industriesDeclined: string[];
    maxRevenue?: number;
    statesDeclined: string[];
    declineWhen: { industry: string; requestedLine: Line; reason: string }[];
  };
  rating: {
    industryMultipliers: Record<string, number>;
    revenueRef: number;
    payrollRef: number;
    lines: Partial<Record<Line, LineRating>>;
  };
  turnaroundMs: number;
};

export type PortalLineResult = {
  line: Line;
  status: "quoted" | "declined" | "needs_info";
  premium?: number;
  deductible?: number;
  limits?: Record<string, number>;
  coverages?: string[];
  exclusions?: string[];
  reason?: string;
};

export type PortalResponse = {
  carrierId: string;
  status: "quoted" | "declined" | "needs_info";
  missing: string[];
  turnaroundMs: number;
  results: PortalLineResult[];
};

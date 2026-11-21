export type Sector = "city" | "county" | "hospital" | "water_utility" | "school" | "airport" | "university";
export type Unit = "usd" | "pct" | "days" | "x" | "count";
export type Severity = "low" | "medium" | "high";
export type EventType =
  | "rating" | "distress" | "state_oversight" | "leadership" | "litigation" | "budget" | "debt_issuance" | "other";
export type DocType = "audit" | "official_statement" | "budget" | "board_minutes" | "other";

export type Citation = { docId: string; docTitle: string; page: number; quote: string; verified: boolean };
export type Metric = { id: string; name: string; value: number; unit: Unit; fiscalYear: number; citation: Citation };
export type Event = {
  id: string; obligorId: string; type: EventType; severity: Severity; headline: string; summary: string;
  dollarAmounts: number[]; date: string;
  source: { kind: "document"; citation: Citation } | { kind: "news"; newsId: string };
};
export type Obligor = {
  id: string; name: string; aliases: string[]; state: string; sector: Sector; rating?: string;
  outstandingDebtUsd?: number; description: string; metrics: Metric[]; events: Event[];
  documentIds: string[]; createdAt: string; updatedAt: string;
};
export type Chunk = { id: string; docId: string; page: number; text: string };
export type Document = {
  id: string; obligorId: string; title: string; type: DocType; fiscalYear?: number; filename: string;
  pageCount: number; pages: string[]; chunks: Chunk[]; status: "indexed" | "error"; mode: "mock" | "live";
  createdAt: string;
};
export type DocumentMeta = Omit<Document, "pages" | "chunks"> & { chunkCount: number };
export type NewsItem = {
  id: string; title: string; text: string; source: string; url?: string; publishedAt: string;
  creditRelevant: boolean; obligorIds: string[]; eventType: EventType; severity: Severity; summary: string;
  dollarAmounts: number[]; mode: "mock" | "live"; createdAt: string;
};
export type Watchlist = { id: string; name: string; obligorIds: string[]; createdAt: string };

// ---- pipeline shapes ----
export type RawCitation = { page: number; quote: string };
export type ExtractedMetric = { name: string; value: number; unit: Unit; fiscalYear: number; page: number; quote: string };
export type ExtractedEvent = {
  type: EventType; severity: Severity; headline: string; summary: string; dollarAmount?: number;
  page: number; quote: string; date?: string;
};
export type Extraction = { metrics: ExtractedMetric[]; events: ExtractedEvent[]; rating?: string; outstandingDebtUsd?: number };
export type DocMeta = { id: string; title: string; type: DocType; fiscalYear?: number; date?: string };
export type NewsClassification = {
  creditRelevant: boolean; obligorIds: string[]; eventType: EventType; severity: Severity;
  summary: string; dollarAmounts: number[];
};
export type Source = { n: number; docId: string; docTitle: string; page: number; text: string };
export type AnswerCitation = { n: number; docId: string; docTitle: string; page: number; quote: string };
export type Answer = { answer: string; citations: AnswerCitation[] };

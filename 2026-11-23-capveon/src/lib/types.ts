export const CATEGORIES = [
  "water",
  "wastewater",
  "stormwater",
  "roads_bridges",
  "buildings",
  "energy",
  "industrial",
  "it_telecom",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const STAGES = ["discussion", "planned", "budgeted", "design", "solicitation", "awarded"] as const;
export type Stage = (typeof STAGES)[number];

export const DOC_KINDS = ["minutes", "cip", "budget", "solicitation", "addendum", "other"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export const REQ_KINDS = [
  "deadline",
  "bond",
  "insurance",
  "certification",
  "spec",
  "submission",
  "experience",
  "other",
] as const;
export type ReqKind = (typeof REQ_KINDS)[number];

export const CHANGE_FIELDS = ["due_date", "questions_deadline", "spec", "quantity", "bond", "other"] as const;
export type ChangeField = (typeof CHANGE_FIELDS)[number];

export interface TeamMember {
  name: string;
  role: string;
}
export interface PastBid {
  title: string;
  agency: string;
  year: number;
  outcome: "won" | "lost" | "pending";
  summary: string;
}
export interface Profile {
  id: "default";
  name: string;
  description: string;
  categories: Category[];
  keywords: string[];
  regions: string[];
  minValue: number;
  maxValue: number;
  certifications: string[];
  bondingCapacity?: number;
  team: TeamMember[];
  pastBids: PastBid[];
}
export interface Agency {
  id: string;
  name: string;
  region: string;
  type: "city" | "county" | "district" | "state" | "authority";
  population?: number;
}
export interface Requirement {
  id: string;
  text: string;
  kind: ReqKind;
  page: number;
  quote: string;
  meetsProfile: "yes" | "no" | "unknown";
  note: string;
  /** Which document the page refers to (the solicitation or one of its addenda). */
  documentId?: string;
}
export interface KeyField {
  value: string; // human text, e.g. "December 18, 2026 2:00 PM"
  iso?: string; // ISO date when parseable
  page: number;
  quote: string;
}
export interface KeyFields {
  bidDue?: KeyField;
  preBid?: KeyField;
  questionsDeadline?: KeyField;
  bidBond?: KeyField;
  engineersEstimate?: KeyField & { amount?: number };
}
export interface Change {
  field: ChangeField;
  before?: string;
  after?: string;
  summary: string;
  page: number;
  quote: string;
}
export interface DocPage {
  n: number;
  text: string;
}
export interface Document {
  id: string;
  agencyId: string;
  title: string;
  kind: DocKind;
  date: string;
  parentDocumentId?: string;
  pages: DocPage[];
  status: "ingested" | "extracted" | "failed";
  error?: string;
  signalIds: string[];
  requirements?: Requirement[];
  keyFields?: KeyFields;
  changes?: Change[];
  createdAt: string;
}
export interface FitBreakdown {
  category: number;
  keywords: number;
  region: number;
  value: number;
}
export interface Source {
  documentId: string;
  page: number;
  quote: string;
}
export interface Signal {
  id: string;
  agencyId: string;
  projectTitle: string;
  category: Category;
  stage: Stage;
  estimatedValue?: number;
  valueText?: string;
  timing?: string;
  summary: string;
  fitScore: number;
  fitBreakdown: FitBreakdown;
  fitRationale: string;
  confidence: number;
  sources: Source[];
  pursuitId?: string;
  createdAt: string;
  updatedAt: string;
}
export interface PursuitEvent {
  id: string;
  at: string;
  type: string;
  summary: string;
  documentId?: string;
  page?: number;
}
export interface Pursuit {
  id: string;
  signalId?: string;
  documentId?: string;
  agencyId: string;
  title: string;
  stage: Stage;
  fitScore: number;
  dueDate?: string;
  status: "active" | "won" | "lost" | "dropped";
  taskIds: string[];
  noteIds: string[];
  events: PursuitEvent[];
  createdAt: string;
}
export interface Task {
  id: string;
  pursuitId: string;
  title: string;
  owner: string;
  dueDate: string;
  done: boolean;
  source: "template" | "llm";
  page?: number;
  /** Anchored to an explicit date from the documents (pre-bid, questions deadline): not shifted on due-date changes. */
  anchored?: boolean;
}
export interface Note {
  id: string;
  pursuitId: string;
  kind: "draft" | "note";
  text: string;
  createdAt: string;
}
export interface Award {
  id: string;
  agencyId: string;
  vendor: string;
  category: string;
  amount: number;
  date: string;
  description: string;
}
export interface Contact {
  id: string;
  agencyId: string;
  name: string;
  title: string;
  role: "decision_maker" | "procurement" | "engineer";
  email?: string;
}

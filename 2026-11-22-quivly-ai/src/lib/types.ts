export type Stage = "onboarding" | "active" | "renewal" | "churned";
export type Band = "green" | "amber" | "red";
export type Side = "vendor" | "customer";

export interface HealthParts {
  usageTrend: number;
  adoptionBreadth: number;
  supportLoad: number;
  billing: number;
  engagementRecency: number;
}
export interface Health {
  score: number;
  band: Band;
  parts: HealthParts;
  inputs: Record<string, number | string>;
  computedAt: string;
  why: string;
}
export interface Account {
  id: string;
  name: string;
  aliases: string[];
  domain: string;
  segment: string;
  plan: string;
  arr: number;
  seats: number;
  quotaUnitsPerWeek: number;
  contractStart: string;
  renewalDate: string;
  owner: string;
  champion: { name: string; title: string; email: string };
  stage: Stage;
  health?: Health;
}
export interface UsageWeek {
  accountId: string;
  weekStart: string;
  activeUsers: number;
  meteredUnits: number;
  ticketsOpened: number;
}
export interface Ticket {
  id: string;
  accountId: string;
  openedAt: string;
  closedAt?: string;
  priority: "low" | "medium" | "high";
  subject: string;
}
export interface Invoice {
  id: string;
  accountId: string;
  issuedAt: string;
  dueAt: string;
  paidAt?: string;
  amount: number;
  status: "paid" | "open" | "overdue";
}
export interface Note {
  id: string;
  accountId: string;
  at: string;
  kind: "note" | "call" | "email" | "slack-draft";
  title: string;
  body: string;
}
export type ProjectKind = "onboarding" | "save_play" | "expansion";
export interface Stakeholder {
  name: string;
  role: string;
  side: Side;
}
export interface Project {
  id: string;
  accountId: string;
  kind: ProjectKind;
  title: string;
  status: "active" | "done";
  createdAt: string;
  goals: string[];
  stakeholders: Stakeholder[];
  risks: string[];
  recap?: string;
  sourceNoteId?: string;
}
export interface Task {
  id: string;
  projectId: string;
  accountId: string;
  title: string;
  ownerSide: Side;
  ownerName?: string;
  dueAt: string;
  isBlocker: boolean;
  done: boolean;
}
export type SignalType =
  | "acquisition" | "funding" | "leadership_change" | "hiring" | "layoffs" | "outage" | "competitor" | "other";
export type Direction = "expansion" | "risk" | "neutral";
export type SuggestedPlay = "expansion_project" | "champion_note" | "exec_check_in" | "none";
export interface Signal {
  id: string;
  title: string;
  text: string;
  source: string;
  url?: string;
  publishedAt: string;
  relevant: boolean;
  accountIds: string[];
  signalType: SignalType;
  direction: Direction;
  summary: string;
  suggestedPlay: SuggestedPlay;
  createdAt: string;
  degraded?: boolean;
}
export type ActionType =
  | "usage_drop" | "renewal_prep" | "onboarding_stalled" | "billing_risk" | "expansion" | "risk";
export interface Action {
  id: string;
  accountId: string;
  type: ActionType;
  priority: "high" | "medium" | "low";
  title: string;
  play: string;
  evidence: Record<string, number | string>;
  rationale: string;
  nextSteps: string[];
  status: "open" | "accepted" | "snoozed" | "dismissed";
  snoozedUntil?: string;
  createdAt: string;
  projectId?: string;
  dedupeKey: string;
  degraded?: boolean;
}
export interface Brief {
  id: string;
  accountId: string;
  createdAt: string;
  markdown: string;
  ask: { proposedArr: number; termMonths: number; justification: string };
  degraded?: boolean;
}
export interface HealthSnapshot {
  accountId: string;
  at: string;
  score: number;
}
export interface DB {
  accounts: Account[];
  usage: UsageWeek[];
  tickets: Ticket[];
  invoices: Invoice[];
  notes: Note[];
  projects: Project[];
  tasks: Task[];
  signals: Signal[];
  actions: Action[];
  briefs: Brief[];
  snapshots: HealthSnapshot[];
}

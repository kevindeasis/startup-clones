import type { Answer, ExtractedSignal, RawRequirement } from "../schemas";
import type { Change, DocKind, FitBreakdown, Profile, Requirement } from "../types";

export interface DocContext {
  title: string;
  kind: DocKind;
  agencyName: string;
  date: string;
}

export interface Chunk {
  id: string;
  documentId: string;
  docTitle: string;
  page: number;
  text: string;
}

export interface LLM {
  mode: "mock" | "live";
  model: string;
  extractSignals(input: { page: number; text: string; doc: DocContext }): Promise<ExtractedSignal[]>;
  writeFitRationale(input: {
    profile: Profile;
    title: string;
    category: string;
    score: number;
    breakdown: FitBreakdown;
    matchedKeywords: string[];
  }): Promise<string>;
  extractRequirements(input: { page: number; text: string; doc: DocContext }): Promise<RawRequirement[]>;
  answerQuestion(input: { question: string; chunks: Chunk[] }): Promise<Answer>;
  suggestTasks(input: {
    pursuitTitle: string;
    requirements: Requirement[];
  }): Promise<{ title: string; page?: number }[]>;
  draftLetter(input: {
    profile: Profile;
    agencyName: string;
    pursuitTitle: string;
    requirements: Requirement[];
  }): Promise<string>;
  extractChanges(input: { page: number; text: string; doc: DocContext; parentTitle: string }): Promise<Change[]>;
}

import type { UIMessage } from "ai";

export type SourceKind = "markdown" | "text" | "email" | "meeting" | "slack" | "csv";

export type Source = {
  id: number;
  title: string;
  kind: SourceKind;
  createdAt: string;
  text: string;
  compiledAt?: string;
  /** One-line summary produced by the extract step (used to rebuild overview.md). */
  summary?: string;
};

export type WikiKind =
  | "overview"
  | "person"
  | "project"
  | "decisions"
  | "open-loops"
  | "timeline"
  | "glossary";

export type WikiPage = {
  path: string;
  title: string;
  kind: WikiKind;
  updated: string;
  sources: number[];
  human_edited?: boolean;
  /** Paragraphs added/changed by a human; the compiler re-inserts them if the LLM drops them. */
  human_blocks?: string[];
  body: string;
};

export type Task = {
  id: string;
  title: string;
  why: string;
  draft: string;
  sourceIds: number[];
  status: "open" | "done" | "dismissed";
  createdAt: string;
};

export type CompileRun = {
  id: string;
  startedAt: string;
  finishedAt: string;
  sourceIds: number[];
  pagesChanged: string[];
  provider: "anthropic" | "mock";
  usage?: { inputTokens: number; outputTokens: number };
  tasksAdded?: number;
};

export type Chat = {
  id: string;
  title: string;
  createdAt: string;
  messages: UIMessage[];
};

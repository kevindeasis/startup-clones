import type { Action } from './agent/actions';

export type Test = {
  id: string;
  name: string;
  startUrl: string;
  steps: string[];
  expectedOutcome: string;
  createdAt: string;
  updatedAt: string;
};

export type ActionRecord = {
  action: Action;
  reasoning?: string;
  ok: boolean;
  error?: string;
  screenshotPath?: string;
  urlAfter?: string;
  tookMs: number;
};

export type RunStep = {
  index: number;
  instruction: string;
  status: 'passed' | 'failed' | 'skipped';
  actions: ActionRecord[];
  startedAt: string;
  finishedAt?: string;
};

export type RunStatus = 'queued' | 'running' | 'passed' | 'failed' | 'error';

export type Run = {
  id: string;
  testId: string;
  status: RunStatus;
  planner: 'anthropic' | 'mock';
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  verdictReason?: string;
  error?: string;
  videoPath?: string;
  finalScreenshotPath?: string;
  steps: RunStep[];
};

export type Schema = { tests: Test[]; runs: Run[] };

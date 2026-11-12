import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getConfig } from './config.js';

export interface RunLogEntry {
  at: string;
  name: string;
  version: number;
  ok: boolean;
  ms: number;
  healed: 'selectors' | 'remint' | null;
  error?: string;
  inputKeys: string[];
  resultCount: number;
}

const file = () => join(getConfig().dataDir, 'runs.jsonl');

/** Only metadata is logged: never input values or secrets. */
export function appendRun(entry: RunLogEntry): void {
  mkdirSync(getConfig().dataDir, { recursive: true });
  appendFileSync(file(), JSON.stringify(entry) + '\n');
}

export function readRuns(): RunLogEntry[] {
  if (!existsSync(file())) return [];
  return readFileSync(file(), 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as RunLogEntry];
      } catch {
        return [];
      }
    });
}

export function recentRuns(limit = 20): RunLogEntry[] {
  return readRuns().slice(-limit).reverse();
}

export function callStats(name: string, now = Date.now()) {
  const runs = readRuns().filter((r) => r.name === name);
  const within = (ms: number) => runs.filter((r) => now - Date.parse(r.at) <= ms).length;
  const last = runs[runs.length - 1];
  return {
    calls24h: within(86400_000),
    calls30d: within(30 * 86400_000),
    lastStatus: last ? (last.ok ? 'ok' : 'failed') : 'never run',
  };
}

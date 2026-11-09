import path from 'node:path';
import fs from 'node:fs';
import { JSONFilePreset } from 'lowdb/node';
import type { Low } from 'lowdb';
import type { Schema, Test } from './types';

export function dataDir() {
  return path.resolve(process.env.DATA_DIR || './data');
}

const SEED_URL = process.env.DEMO_URL || 'http://localhost:3000/demo';
const LOGIN = [
  'Type "demo" into the "Username" field',
  'Type "demo123" into the "Password" field',
  'Click the "Sign in" button',
];

function seedTests(): Test[] {
  const now = new Date().toISOString();
  const mk = (n: number, name: string, steps: string[], expectedOutcome: string): Test => ({
    id: `seed${n}`, name, startUrl: SEED_URL, steps, expectedOutcome, createdAt: now, updatedAt: now,
  });
  const addTodo = ['Type "Buy milk" into the "New todo" field', 'Click the "Add" button'];
  return [
    mk(1, 'Login and add a todo', [...LOGIN, ...addTodo, 'Verify that "Buy milk" is visible'], 'The page contains "1 items left"'),
    mk(2, 'Wrong password shows an error', [
      'Type "demo" into the "Username" field',
      'Type "wrong" into the "Password" field',
      'Click the "Sign in" button',
    ], 'The page contains "Invalid credentials"'),
    mk(3, 'Completing the last todo shows zero left (known bug)', [...LOGIN, ...addTodo, 'Click the "Buy milk" checkbox'], 'The page contains "0 items left"'),
  ];
}

const g = globalThis as unknown as { __db?: Promise<Low<Schema>> };

export function getDb(): Promise<Low<Schema>> {
  if (!g.__db) {
    g.__db = (async () => {
      fs.mkdirSync(path.join(dataDir(), 'runs'), { recursive: true });
      const db = await JSONFilePreset<Schema>(path.join(dataDir(), 'db.json'), { tests: [], runs: [] });
      if (db.data.tests.length === 0) {
        db.data.tests.push(...seedTests());
        await db.write();
      }
      return db;
    })();
  }
  return g.__db;
}

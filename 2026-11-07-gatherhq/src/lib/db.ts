import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { customAlphabet } from "nanoid";

const newId = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 10);
export const genId = () => newId();
export const genToken = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 20);
export const now = () => new Date().toISOString();

const g = globalThis as unknown as { __gl_db?: Database.Database };

export function db(): Database.Database {
  if (g.__gl_db) return g.__gl_db;
  const file = path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.DATABASE_PATH || "./data/gatherlite.db");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const d = new Database(file);
  d.pragma("journal_mode = WAL");
  d.pragma("foreign_keys = ON");
  d.exec(fs.readFileSync(path.resolve(/*turbopackIgnore: true*/ process.cwd(), "schema.sql"), "utf8"));
  g.__gl_db = d;
  return d;
}

export type Study = { id: string; title: string; goal: string; audience: string; status: string; created_at: string };
export type Question = { id: string; study_id: string; position: number; text: string };
export type Interview = {
  id: string; study_id: string; token: string; participant_name: string | null; persona: string | null;
  synthetic: number; status: string; created_at: string; completed_at: string | null;
};
export type Message = { id: string; interview_id: string; role: "assistant" | "user"; content: string; kind: string | null; created_at: string };

export function getStudy(id: string) {
  return db().prepare("SELECT * FROM studies WHERE id = ?").get(id) as Study | undefined;
}
export function getQuestions(studyId: string) {
  return db().prepare("SELECT * FROM questions WHERE study_id = ? ORDER BY position").all(studyId) as Question[];
}
export function replaceQuestions(studyId: string, texts: string[]) {
  const d = db();
  d.transaction(() => {
    d.prepare("DELETE FROM questions WHERE study_id = ?").run(studyId);
    texts.forEach((t, i) => d.prepare("INSERT INTO questions (id, study_id, position, text) VALUES (?,?,?,?)").run(genId(), studyId, i + 1, t));
  })();
}
export function getInterviews(studyId: string) {
  return db().prepare("SELECT * FROM interviews WHERE study_id = ? ORDER BY created_at, rowid").all(studyId) as Interview[];
}
export function getInterviewByToken(token: string) {
  return db().prepare("SELECT * FROM interviews WHERE token = ?").get(token) as Interview | undefined;
}
export function createInterview(studyId: string, opts: { name?: string | null; persona?: unknown; synthetic?: boolean } = {}) {
  const row: Interview = {
    id: genId(), study_id: studyId, token: genToken(), participant_name: opts.name ?? null,
    persona: opts.persona ? JSON.stringify(opts.persona) : null, synthetic: opts.synthetic ? 1 : 0,
    status: "in_progress", created_at: now(), completed_at: null,
  };
  db().prepare(
    "INSERT INTO interviews (id, study_id, token, participant_name, persona, synthetic, status, created_at) VALUES (?,?,?,?,?,?,?,?)",
  ).run(row.id, row.study_id, row.token, row.participant_name, row.persona, row.synthetic, row.status, row.created_at);
  return row;
}
export function getMessages(interviewId: string) {
  return db().prepare("SELECT * FROM messages WHERE interview_id = ? ORDER BY rowid").all(interviewId) as Message[];
}
export function addMessage(interviewId: string, role: "assistant" | "user", content: string, kind: string | null = null) {
  db().prepare("INSERT INTO messages (id, interview_id, role, content, kind, created_at) VALUES (?,?,?,?,?,?)")
    .run(genId(), interviewId, role, content, kind, now());
}
export function completeInterview(interviewId: string) {
  db().prepare("UPDATE interviews SET status='complete', completed_at=? WHERE id=?").run(now(), interviewId);
}
export function latestModel(studyId: string) {
  const r = db().prepare("SELECT * FROM buyer_models WHERE study_id = ? ORDER BY version DESC LIMIT 1").get(studyId) as
    | { id: string; version: number; model_json: string; created_at: string } | undefined;
  return r ? { id: r.id, version: r.version, created_at: r.created_at, model: JSON.parse(r.model_json) as BuyerModel } : null;
}
export function saveModel(studyId: string, model: BuyerModel) {
  const prev = latestModel(studyId);
  const version = (prev?.version ?? 0) + 1;
  db().prepare("INSERT INTO buyer_models (id, study_id, version, model_json, created_at) VALUES (?,?,?,?,?)")
    .run(genId(), studyId, version, JSON.stringify(model), now());
  db().prepare("UPDATE studies SET status='modeled' WHERE id=?").run(studyId);
  return version;
}

import type { BuyerModel } from "./schemas";

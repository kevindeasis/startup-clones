import crypto from "node:crypto";
import { getDb } from "./db";
import type { Area, ChatMessage, InterviewExtraction, Participant, ParticipantStatus, Study, StudySynthesis } from "./schemas";

type Row = Record<string, unknown>;
const now = () => new Date().toISOString();
const newToken = () => crypto.randomBytes(12).toString("base64url").slice(0, 16);

const toStudy = (r: Row): Study => ({
  id: r.id as string, title: r.title as string, topic: r.topic as string, goal: r.goal as string,
  teams: JSON.parse(r.teams_json as string), createdAt: r.created_at as string,
});
const toParticipant = (r: Row): Participant => ({
  id: r.id as string, studyId: r.study_id as string, token: r.token as string, name: r.name as string,
  team: r.team as string, site: r.site as string, role: r.role as string, status: r.status as ParticipantStatus,
  createdAt: r.created_at as string, completedAt: (r.completed_at as string | null) ?? null,
});

export function createStudy(input: { title: string; topic: string; goal: string; teams: string[] }): Study {
  const id = crypto.randomUUID();
  getDb().prepare("INSERT INTO studies VALUES (?,?,?,?,?,?)").run(id, input.title, input.topic, input.goal, JSON.stringify(input.teams), now());
  return getStudy(id)!;
}
export function listStudies(): (Study & { participantCount: number; completedCount: number })[] {
  const rows = getDb().prepare(
    `SELECT s.*, COUNT(p.id) AS pc, COALESCE(SUM(p.status='completed'),0) AS cc
     FROM studies s LEFT JOIN participants p ON p.study_id = s.id GROUP BY s.id ORDER BY s.created_at DESC`,
  ).all() as Row[];
  return rows.map((r) => ({ ...toStudy(r), participantCount: r.pc as number, completedCount: r.cc as number }));
}
export function getStudy(id: string): Study | undefined {
  const r = getDb().prepare("SELECT * FROM studies WHERE id = ?").get(id) as Row | undefined;
  return r && toStudy(r);
}
export function findStudyByTitle(title: string): Study | undefined {
  const r = getDb().prepare("SELECT * FROM studies WHERE title = ?").get(title) as Row | undefined;
  return r && toStudy(r);
}

export function addParticipant(studyId: string, input: { name: string; team: string; site: string; role: string }): Participant {
  const id = crypto.randomUUID();
  getDb().prepare("INSERT INTO participants (id, study_id, token, name, team, site, role, status, created_at) VALUES (?,?,?,?,?,?,?,'invited',?)")
    .run(id, studyId, newToken(), input.name, input.team, input.site, input.role, now());
  return getParticipant(id)!;
}
export function getParticipant(id: string): Participant | undefined {
  const r = getDb().prepare("SELECT * FROM participants WHERE id = ?").get(id) as Row | undefined;
  return r && toParticipant(r);
}
export function getParticipantByToken(token: string): Participant | undefined {
  const r = getDb().prepare("SELECT * FROM participants WHERE token = ?").get(token) as Row | undefined;
  return r && toParticipant(r);
}
export function listParticipants(studyId: string): Participant[] {
  return (getDb().prepare("SELECT * FROM participants WHERE study_id = ? ORDER BY created_at, rowid").all(studyId) as Row[]).map(toParticipant);
}
export function setStatus(id: string, status: ParticipantStatus, completedAt: string | null = null): void {
  getDb().prepare("UPDATE participants SET status = ?, completed_at = COALESCE(?, completed_at) WHERE id = ?").run(status, completedAt, id);
}

export function addMessage(participantId: string, role: ChatMessage["role"], content: string): void {
  getDb().prepare("INSERT INTO messages (participant_id, role, content, created_at) VALUES (?,?,?,?)").run(participantId, role, content, now());
}
export function getMessages(participantId: string): ChatMessage[] {
  return getDb().prepare("SELECT role, content FROM messages WHERE participant_id = ? ORDER BY id").all(participantId) as ChatMessage[];
}

export function getCoverage(participantId: string): Area[] {
  const r = getDb().prepare("SELECT areas_json FROM coverage WHERE participant_id = ?").get(participantId) as Row | undefined;
  return r ? JSON.parse(r.areas_json as string) : [];
}
export function unionCoverage(participantId: string, areas: Area[]): Area[] {
  const merged = [...new Set([...getCoverage(participantId), ...areas])];
  getDb().prepare("INSERT INTO coverage VALUES (?,?) ON CONFLICT(participant_id) DO UPDATE SET areas_json = excluded.areas_json")
    .run(participantId, JSON.stringify(merged));
  return merged;
}

export function saveExtraction(participantId: string, e: InterviewExtraction, model: string): void {
  getDb().prepare("INSERT OR REPLACE INTO extractions VALUES (?,?,?,?)").run(participantId, JSON.stringify(e), model, now());
}
export function getExtraction(participantId: string): InterviewExtraction | undefined {
  const r = getDb().prepare("SELECT json FROM extractions WHERE participant_id = ?").get(participantId) as Row | undefined;
  return r ? JSON.parse(r.json as string) : undefined;
}

export type StoredSynthesis = { synthesis: StudySynthesis; mermaid: string; model: string; interviewCount: number; createdAt: string };
export function saveSynthesis(studyId: string, s: StudySynthesis, mermaid: string, model: string, count: number): void {
  getDb().prepare("INSERT OR REPLACE INTO syntheses VALUES (?,?,?,?,?,?)").run(studyId, JSON.stringify(s), mermaid, model, count, now());
}
export function getSynthesis(studyId: string): StoredSynthesis | undefined {
  const r = getDb().prepare("SELECT * FROM syntheses WHERE study_id = ?").get(studyId) as Row | undefined;
  return r && { synthesis: JSON.parse(r.json as string), mermaid: r.mermaid as string, model: r.model as string, interviewCount: r.interview_count as number, createdAt: r.created_at as string };
}

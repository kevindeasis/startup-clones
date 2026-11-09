import crypto from "node:crypto";
import { getDb, now } from "./db";
import { importCsv, importText } from "./importer";
import { QUESTION, SAMPLE_CALLS, SAMPLE_CSV, SAMPLE_TICKETS } from "./sample";
import { generateHypotheses, interviewerNext, scoreInterview } from "./llm";
import { updateConfidence } from "./confidence";
import { mockSummary, type EvidenceRow, type HypothesisLite, type Msg } from "./mock";

export const maxTurns = () => Number(process.env.INTERVIEW_TURNS) || 5;
const CLOSING = "Thank you, that is all I needed. Your answers have been recorded.";

export class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

export function listProjects() {
  return getDb().prepare("SELECT * FROM projects ORDER BY id DESC").all();
}

export function createProject(name: string, question: string) {
  const r = getDb().prepare("INSERT INTO projects(name, question, created_at) VALUES(?,?,?)").run(name, question, now());
  return Number(r.lastInsertRowid);
}

export function createSampleProject() {
  const id = createProject("Sample SaaS churn study", QUESTION);
  const db = getDb();
  const csv = importCsv(db, id, SAMPLE_CSV);
  const t = importText(db, id, SAMPLE_TICKETS, "ticket");
  const c = importText(db, id, SAMPLE_CALLS, "call");
  return { id, accounts: csv.accounts, evidence: csv.evidence + t.evidence + c.evidence };
}

function mustProject(id: number) {
  const p = getDb().prepare("SELECT * FROM projects WHERE id=?").get(id) as { id: number; name: string; question: string; created_at: string } | undefined;
  if (!p) throw new HttpError(404, "project not found");
  return p;
}

export function importData(projectId: number, body: { csv?: string; tickets?: string; calls?: string }) {
  mustProject(projectId);
  const db = getDb();
  const out = { accounts: 0, evidence: 0 };
  if (body.csv?.trim()) { const r = importCsv(db, projectId, body.csv); out.accounts += r.accounts; out.evidence += r.evidence; }
  if (body.tickets?.trim()) out.evidence += importText(db, projectId, body.tickets, "ticket").evidence;
  if (body.calls?.trim()) out.evidence += importText(db, projectId, body.calls, "call").evidence;
  return out;
}

function hypRows(projectId: number) {
  const rows = getDb().prepare("SELECT * FROM hypotheses WHERE project_id=? ORDER BY confidence DESC, id").all(projectId) as
    { id: number; statement: string; confidence: number; rationale: string; evidence_ids_json: string }[];
  const findings = getDb().prepare("SELECT f.*, i.account_id FROM findings f JOIN interviews i ON i.id=f.interview_id WHERE f.hypothesis_id IN (SELECT id FROM hypotheses WHERE project_id=?)").all(projectId) as
    { id: number; hypothesis_id: number; interview_id: number; stance: string; quote: string; account_id: number | null }[];
  return rows.map((h) => {
    const fs = findings.filter((f) => f.hypothesis_id === h.id);
    return {
      id: h.id, statement: h.statement, confidence: h.confidence, rationale: h.rationale,
      evidenceIds: JSON.parse(h.evidence_ids_json) as number[],
      supports: fs.filter((f) => f.stance === "supports").length,
      contradicts: fs.filter((f) => f.stance === "contradicts").length,
      findings: fs.filter((f) => f.quote).map((f) => ({ stance: f.stance, quote: f.quote, interviewId: f.interview_id, accountId: f.account_id })),
    };
  });
}

export function getProjectView(projectId: number) {
  const db = getDb();
  const project = mustProject(projectId);
  const accounts = (db.prepare("SELECT * FROM accounts WHERE project_id=? ORDER BY id").all(projectId) as { id: number; external_id: string; name: string; attrs_json: string }[])
    .map((a) => ({ id: a.id, externalId: a.external_id, name: a.name, attrs: JSON.parse(a.attrs_json) as Record<string, unknown> }));
  const evidence = db.prepare("SELECT id, account_id AS accountId, kind, text FROM evidence WHERE project_id=? ORDER BY id").all(projectId);
  const interviews = (db.prepare("SELECT * FROM interviews WHERE project_id=? ORDER BY id DESC").all(projectId) as { id: number; account_id: number | null; token: string; status: string; created_at: string }[])
    .map((i) => ({
      id: i.id, accountId: i.account_id, token: i.token, status: i.status, createdAt: i.created_at,
      messages: db.prepare("SELECT role, content FROM messages WHERE interview_id=? ORDER BY id").all(i.id),
    }));
  return { project, accounts, evidence, hypotheses: hypRows(projectId), interviews };
}

export async function runHypotheses(projectId: number) {
  const db = getDb();
  const p = mustProject(projectId);
  const evidence = db.prepare("SELECT id, kind, text, account_id FROM evidence WHERE project_id=? ORDER BY id").all(projectId) as EvidenceRow[];
  if (!evidence.length) throw new HttpError(400, "import data first");
  const accounts = (db.prepare("SELECT attrs_json FROM accounts WHERE project_id=?").all(projectId) as { attrs_json: string }[]).map((a) => ({ attrs: JSON.parse(a.attrs_json) }));
  const result = await generateHypotheses(p.question, accounts, evidence);
  db.transaction(() => {
    db.prepare("DELETE FROM findings WHERE hypothesis_id IN (SELECT id FROM hypotheses WHERE project_id=?)").run(projectId);
    db.prepare("DELETE FROM hypotheses WHERE project_id=?").run(projectId);
    for (const h of result.hypotheses)
      db.prepare("INSERT INTO hypotheses(project_id, statement, confidence, rationale, evidence_ids_json) VALUES(?,?,?,?,?)")
        .run(projectId, h.statement, h.confidence, h.rationale, JSON.stringify(h.evidenceIds));
  })();
  return hypRows(projectId);
}

const newToken = () => crypto.randomBytes(12).toString("base64url");

function loadMessages(interviewId: number): Msg[] {
  return getDb().prepare("SELECT role, content FROM messages WHERE interview_id=? ORDER BY id").all(interviewId) as Msg[];
}
function loadHyps(projectId: number): HypothesisLite[] {
  return getDb().prepare("SELECT id, statement, confidence FROM hypotheses WHERE project_id=? ORDER BY confidence DESC").all(projectId) as HypothesisLite[];
}
function addMessage(interviewId: number, role: "assistant" | "user", content: string) {
  getDb().prepare("INSERT INTO messages(interview_id, role, content, created_at) VALUES(?,?,?,?)").run(interviewId, role, content, now());
}

export async function createInterview(projectId: number, accountId: number | null) {
  const db = getDb();
  const p = mustProject(projectId);
  if (accountId !== null && !db.prepare("SELECT 1 FROM accounts WHERE id=? AND project_id=?").get(accountId, projectId)) throw new HttpError(400, "unknown account");
  const hyps = loadHyps(projectId);
  if (!hyps.length) throw new HttpError(400, "generate hypotheses first");
  const token = newToken();
  const r = db.prepare("INSERT INTO interviews(project_id, account_id, token, status, created_at) VALUES(?,?,?,?,?)").run(projectId, accountId, token, "pending", now());
  const id = Number(r.lastInsertRowid);
  const q = await interviewerNext(p.question, hyps, []);
  addMessage(id, "assistant", q === "DONE" ? CLOSING : q);
  return { id, token, url: `/i/${token}` };
}

function mustInterview(token: string) {
  const i = getDb().prepare("SELECT * FROM interviews WHERE token=?").get(token) as { id: number; project_id: number; account_id: number | null; status: string } | undefined;
  if (!i) throw new HttpError(404, "interview not found");
  return i;
}

export function getInterviewState(token: string) {
  const i = mustInterview(token);
  const p = mustProject(i.project_id);
  const messages = loadMessages(i.id);
  return { status: i.status, question: p.question, messages, turn: messages.filter((m) => m.role === "user").length, maxTurns: maxTurns() };
}

export async function postMessage(token: string, content: string) {
  const i = mustInterview(token);
  if (i.status === "done") throw new HttpError(409, "interview already finished");
  if (!content.trim()) throw new HttpError(400, "empty message");
  const db = getDb();
  db.prepare("UPDATE interviews SET status='active' WHERE id=?").run(i.id);
  addMessage(i.id, "user", content.trim());
  const messages = loadMessages(i.id);
  const turns = messages.filter((m) => m.role === "user").length;
  let reply = CLOSING;
  let done = true;
  if (turns < maxTurns()) {
    const q = await interviewerNext(mustProject(i.project_id).question, loadHyps(i.project_id), messages);
    if (q !== "DONE" && !/^DONE\b/.test(q)) { reply = q; done = false; }
  }
  addMessage(i.id, "assistant", reply);
  return { reply, done, turn: turns, maxTurns: maxTurns() };
}

export async function finishInterview(token: string) {
  const i = mustInterview(token);
  const db = getDb();
  const existing = () => db.prepare("SELECT hypothesis_id AS hypothesisId, stance, quote FROM findings WHERE interview_id=?").all(i.id);
  if (i.status === "done") return { findings: existing(), already: true };
  const messages = loadMessages(i.id);
  if (!messages.some((m) => m.role === "user")) throw new HttpError(400, "no respondent messages yet");
  const hyps = loadHyps(i.project_id);
  const scored = await scoreInterview(hyps, messages);
  const byId = new Map(hyps.map((h) => [h.id, h]));
  db.transaction(() => {
    for (const f of scored.findings) {
      const h = byId.get(f.hypothesisId);
      if (!h) continue;
      db.prepare("INSERT INTO findings(hypothesis_id, interview_id, stance, quote) VALUES(?,?,?,?)").run(h.id, i.id, f.stance, f.quote);
      db.prepare("UPDATE hypotheses SET confidence=? WHERE id=?").run(updateConfidence(h.confidence, f.stance), h.id);
    }
    db.prepare("UPDATE interviews SET status='done' WHERE id=?").run(i.id);
    if (i.account_id) {
      const a = db.prepare("SELECT attrs_json FROM accounts WHERE id=?").get(i.account_id) as { attrs_json: string };
      const attrs = { ...JSON.parse(a.attrs_json), interview_summary: mockSummary(messages.filter((m) => m.role === "user").map((m) => m.content)) };
      db.prepare("UPDATE accounts SET attrs_json=? WHERE id=?").run(JSON.stringify(attrs), i.account_id);
    }
  })();
  return { findings: existing(), already: false };
}

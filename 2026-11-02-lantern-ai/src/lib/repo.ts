import { all, get, run, uid, now, type Row } from './db';
import type { Criterion } from './schemas';
import { overallScore, finalRecommendation, type CriterionScore } from './score';
import { reviewCandidate } from './ai/reviewCandidate';

export type HiringModel = {
  id: string; role_id: string; version: number; status: string;
  criteria: Criterion[]; taste_notes: string[]; change_summary: string; created_at: string;
};
const toModel = (r: Row): HiringModel => ({
  id: r.id, role_id: r.role_id, version: r.version, status: r.status,
  criteria: JSON.parse(r.criteria_json), taste_notes: JSON.parse(r.taste_notes_json || '[]'),
  change_summary: r.change_summary || '', created_at: r.created_at,
});

export const getRole = (id: string) => get('SELECT * FROM roles WHERE id=?', id);
export const listRoles = () => all('SELECT * FROM roles ORDER BY created_at DESC');
export function createRole(title: string, jd: string) {
  const id = uid();
  run('INSERT INTO roles VALUES(?,?,?,?)', id, title, jd, now());
  return getRole(id)!;
}

export function insertModel(roleId: string, version: number, status: string, criteria: Criterion[], taste: string[], summary: string) {
  const id = uid();
  run('INSERT INTO hiring_models VALUES(?,?,?,?,?,?,?,?)', id, roleId, version, status, JSON.stringify(criteria), JSON.stringify(taste), summary, now());
  return toModel(get('SELECT * FROM hiring_models WHERE id=?', id)!);
}
export const getModelById = (id: string) => { const r = get('SELECT * FROM hiring_models WHERE id=?', id); return r ? toModel(r) : null; };
export const listModels = (roleId: string) => all('SELECT * FROM hiring_models WHERE role_id=? ORDER BY version DESC, created_at DESC', roleId).map(toModel);
export function latestApproved(roleId: string) {
  const r = get("SELECT * FROM hiring_models WHERE role_id=? AND status='approved' ORDER BY version DESC, created_at DESC LIMIT 1", roleId);
  return r ? toModel(r) : null;
}
export function pendingProposal(roleId: string) {
  const a = latestApproved(roleId);
  const r = get("SELECT * FROM hiring_models WHERE role_id=? AND status='proposed' AND version>? ORDER BY version DESC LIMIT 1", roleId, a?.version ?? 0);
  return r ? toModel(r) : null;
}
export function pendingDraft(roleId: string) {
  const r = get("SELECT * FROM hiring_models WHERE role_id=? AND status='proposed' AND version=1 ORDER BY created_at DESC LIMIT 1", roleId);
  return r ? toModel(r) : null;
}
export const setModelStatus = (id: string, status: string) => run('UPDATE hiring_models SET status=? WHERE id=?', status, id);
export function updateDraft(id: string, criteria: Criterion[], taste: string[]) {
  run("UPDATE hiring_models SET status='approved', criteria_json=?, taste_notes_json=?, change_summary='Initial hiring model' WHERE id=?", JSON.stringify(criteria), JSON.stringify(taste), id);
}
export const maxVersion = (roleId: string) => (get('SELECT MAX(version) v FROM hiring_models WHERE role_id=?', roleId)?.v as number | null) ?? 0;

export const listCandidates = (roleId: string) => all('SELECT * FROM candidates WHERE role_id=? ORDER BY created_at, rowid', roleId);
export const getCandidate = (id: string) => get('SELECT * FROM candidates WHERE id=?', id);
export function createCandidate(roleId: string, name: string, filename: string | null, text: string) {
  const id = uid();
  run('INSERT INTO candidates VALUES(?,?,?,?,?,?)', id, roleId, name, filename, text, now());
  return getCandidate(id)!;
}

export type Review = {
  id: string; candidate_id: string; hiring_model_id: string; overall_score: number; recommendation: string; summary: string;
  criteria_scores: (CriterionScore)[]; open_questions: string[]; created_at: string;
};
const toReview = (r: Row): Review => ({
  id: r.id, candidate_id: r.candidate_id, hiring_model_id: r.hiring_model_id, overall_score: r.overall_score,
  recommendation: r.recommendation, summary: r.summary, criteria_scores: JSON.parse(r.criteria_scores_json),
  open_questions: JSON.parse(r.open_questions_json), created_at: r.created_at,
});

/** Current review: latest review for the latest approved model, else the latest review. */
export function currentReview(candidateId: string, roleId: string): Review | null {
  const m = latestApproved(roleId);
  let r = m ? get('SELECT * FROM reviews WHERE candidate_id=? AND hiring_model_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1', candidateId, m.id) : undefined;
  if (!r) r = get('SELECT * FROM reviews WHERE candidate_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1', candidateId);
  return r ? toReview(r) : null;
}
export const latestDecision = (cid: string) => get('SELECT * FROM decisions WHERE candidate_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1', cid) ?? null;
export function addDecision(cid: string, decision: string, reason: string) {
  const id = uid();
  run('INSERT INTO decisions VALUES(?,?,?,?,?)', id, cid, decision, reason, now());
  return get('SELECT * FROM decisions WHERE id=?', id)!;
}
export function latestPlan(cid: string) {
  const r = get('SELECT * FROM interview_plans WHERE candidate_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1', cid);
  return r ? { id: r.id, created_at: r.created_at, questions: JSON.parse(r.questions_json) } : null;
}
export function savePlan(cid: string, questions: unknown) {
  run('INSERT INTO interview_plans VALUES(?,?,?,?)', uid(), cid, JSON.stringify(questions), now());
  return latestPlan(cid)!;
}

/** Run the LLM review against the latest approved model and store it. */
export async function reviewAndStore(candidateId: string): Promise<Review> {
  const cand = getCandidate(candidateId)!;
  const model = latestApproved(cand.role_id);
  if (!model) throw new Error('No approved hiring model for this role yet');
  const out = await reviewCandidate(cand.resume_text, model);
  // normalise: exactly one score per criterion
  const scores: CriterionScore[] = model.criteria.map((c) => {
    const s = out.criteria_scores.find((x) => x.criterion_id === c.id);
    return s ? { ...s, score: Math.max(0, Math.min(5, s.score)) } : { criterion_id: c.id, score: 0, evidence: 'none found', confidence: 'low' as const };
  });
  const questions = out.open_questions.length ? out.open_questions : ['What additional context can you share about your most relevant work?'];
  const overall = overallScore(model.criteria, scores);
  const rec = finalRecommendation(model.criteria, scores, out.recommendation);
  const id = uid();
  run('INSERT INTO reviews VALUES(?,?,?,?,?,?,?,?,?)', id, candidateId, model.id, overall, rec, out.summary, JSON.stringify(scores), JSON.stringify(questions), now());
  return toReview(get('SELECT * FROM reviews WHERE id=?', id)!);
}

export const listMessages = (roleId: string) => all('SELECT * FROM analytics_messages WHERE role_id=? ORDER BY created_at, rowid', roleId);
export const addMessage = (roleId: string, role: 'user' | 'assistant', content: string) =>
  run('INSERT INTO analytics_messages VALUES(?,?,?,?,?)', uid(), roleId, role, content, now());

/** Compact pipeline summary used by the analytics chat. */
export function pipelineSummary(roleId: string) {
  const role = getRole(roleId)!;
  const model = latestApproved(roleId);
  const cands = listCandidates(roleId).map((c) => {
    const r = currentReview(c.id, roleId);
    const d = latestDecision(c.id);
    const byName: Record<string, number> = {};
    r?.criteria_scores.forEach((s) => { const cr = model?.criteria.find((x) => x.id === s.criterion_id); if (cr) byName[cr.name] = s.score; });
    return {
      id: c.id, name: c.name, overall_score: r?.overall_score ?? null, recommendation: r?.recommendation ?? null,
      decision: (d?.decision as string) ?? null, decision_reason: (d?.reason as string) ?? null,
      model_version: r ? getModelById(r.hiring_model_id)?.version ?? null : null, criterion_scores: byName,
    };
  });
  const recs: Record<string, number> = {};
  cands.forEach((c) => { if (c.recommendation) recs[c.recommendation] = (recs[c.recommendation] || 0) + 1; });
  const per_criterion = (model?.criteria ?? []).map((cr) => {
    const vals = cands.map((c) => c.criterion_scores[cr.name]).filter((v) => v != null);
    return {
      name: cr.name, weight: cr.weight, type: cr.type,
      avg_score: vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100 : null,
      candidates_scoring_0_or_1: vals.filter((v) => v <= 1).length,
    };
  });
  return {
    role: role.title,
    counts: {
      total: cands.length,
      advanced: cands.filter((c) => c.decision === 'advance').length,
      rejected: cands.filter((c) => c.decision === 'reject').length,
      undecided: cands.filter((c) => !c.decision).length,
      recommendations: recs,
    },
    candidates: cands,
    per_criterion,
    current_model: model ? { version: model.version, taste_notes: model.taste_notes } : null,
    model_history: listModels(roleId).map((m) => ({ version: m.version, status: m.status, change_summary: m.change_summary })),
  };
}

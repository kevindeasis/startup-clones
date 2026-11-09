import { structured, MOCK_LLM } from '../llm';
import { ProposeOut, type Criterion } from '../schemas';
import type { ModelLike } from './reviewCandidate';

export type DecisionWithReview = {
  candidate: string;
  decision: 'advance' | 'reject';
  reason: string;
  overall_score: number | null;
  scores: { criterion_id: string; score: number }[];
};
export type Proposal = { criteria: Criterion[]; taste_notes: string[]; change_summary: string };

export async function proposeModelUpdate(model: ModelLike, ds: DecisionWithReview[]): Promise<Proposal> {
  if (ds.length < 2) return { ...model, change_summary: 'Not enough decisions yet' };
  const out = MOCK_LLM ? mockPropose(model, ds) : await llmPropose(model, ds);
  // Keep ids stable; assign ids for new criteria.
  const used = new Set(model.criteria.map((c) => c.id));
  const criteria = out.criteria.map((c, i) => {
    let id = c.id && (used.has(c.id) || !model.criteria.length) ? c.id : undefined;
    if (!id) id = `c${Date.now().toString(36)}${i}`;
    return { ...c, id } as Criterion;
  });
  return { criteria, taste_notes: out.taste_notes, change_summary: out.change_summary.trim() || 'No material changes proposed.' };
}

async function llmPropose(model: ModelLike, ds: DecisionWithReview[]) {
  const system = `You maintain a team's hiring model. Given the current rubric, taste notes, and the team's advance/reject decisions with reasons, propose a revised model that better predicts their decisions. Change as little as needed; explain each change.
Keep existing criterion ids for existing criteria. Weights are integers 1-5. Never add criteria based on protected characteristics. Put free-text preferences in taste_notes. change_summary explains each change in plain language.`;
  return structured(ProposeOut, system, JSON.stringify({ current_model: model, decisions: ds }, null, 2));
}

function mockPropose(model: ModelLike, ds: DecisionWithReview[]) {
  const adv = ds.filter((d) => d.decision === 'advance');
  const rej = ds.filter((d) => d.decision === 'reject');
  const avg = (list: DecisionWithReview[], id: string) =>
    list.length ? list.reduce((a, d) => a + (d.scores.find((s) => s.criterion_id === id)?.score ?? 0), 0) / list.length : 0;
  const changes: string[] = [];
  const criteria = model.criteria.map((c) => {
    const gap = avg(adv, c.id) - avg(rej, c.id);
    let weight = c.weight;
    if (adv.length && rej.length) {
      if (gap >= 1 && weight < 5) weight++;
      else if (gap <= -1 && weight > 1) weight--;
    }
    if (weight !== c.weight) changes.push(`Weight of "${c.name}" ${c.weight} -> ${weight} (advanced candidates scored ${gap >= 0 ? 'higher' : 'lower'} on it than rejected ones).`);
    return { ...c, weight };
  });
  const note = `Recent reasons from the team: ${ds.slice(0, 3).map((d) => `${d.decision} - ${d.reason}`).join(' | ').slice(0, 300)}`;
  const taste_notes = [...model.taste_notes.filter((n) => !n.startsWith('Recent reasons from the team:')), note];
  changes.push('Added a taste note summarizing recent decision reasons.');
  return { criteria, taste_notes, change_summary: `[mock] Based on ${ds.length} decisions (${adv.length} advance, ${rej.length} reject). ${changes.join(' ')}` };
}

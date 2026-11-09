import type { Criterion, Rec, ReviewOutput, PlanQuestion } from '../schemas';

const STOP = new Set('with that this from have will your their they them been were what when which about into over more than also such like and the for are you our can should would could must strong experience years work working team teams ability using use used able build building'.split(' '));
export const words = (s: string) => (s.toLowerCase().match(/[a-z][a-z+#.\-]{2,}/g) || []).map((w) => w.replace(/[.\-]+$/, ''));
export const keywords = (s: string) => [...new Set(words(s).filter((w) => !STOP.has(w) && w.length > 3))];

export function mockDraft(jd: string): Omit<Criterion, 'id'>[] {
  const bullets = jd.split('\n').map((l) => l.trim()).filter((l) => /^[-*•]\s+/.test(l)).map((l) => l.replace(/^[-*•]\s+/, ''));
  const generic = ['Relevant domain experience', 'Technical depth', 'Ownership and delivery', 'Communication and collaboration', 'Growth and learning'];
  const items = [...bullets.slice(0, 7)];
  for (const g of generic) if (items.length < 4) items.push(g);
  return items.slice(0, 8).map((text, i) => {
    const name = text.split(/[.:;,(]/)[0].split(' ').slice(0, 6).join(' ').trim() || `Criterion ${i + 1}`;
    return {
      name: name.charAt(0).toUpperCase() + name.slice(1),
      description: text,
      weight: i < 3 ? 5 - i : 2,
      type: i < 3 ? ('must_have' as const) : ('nice_to_have' as const),
    };
  });
}

export function mockReview(resume: string, criteria: Criterion[], taste: string[]): ReviewOutput {
  const rtokens = new Set(words(resume));
  const lines = resume.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const tasteHits = taste.flatMap(keywords).filter((k) => rtokens.has(k)).length;
  const criteria_scores = criteria.map((c) => {
    const kws = keywords(`${c.name} ${c.description}`);
    const hit = kws.filter((k) => rtokens.has(k));
    const ratio = hit.length / Math.max(1, Math.min(kws.length, 5));
    const score = Math.max(0, Math.min(5, Math.round(ratio * 5)));
    const line = lines.find((l) => hit.some((h) => l.toLowerCase().includes(h)));
    return {
      criterion_id: c.id,
      score,
      evidence: line ? line.slice(0, 200) : 'none found',
      confidence: (hit.length >= 3 ? 'high' : hit.length >= 1 ? 'medium' : 'low') as 'low' | 'medium' | 'high',
    };
  });
  const open_questions = criteria_scores
    .filter((s) => s.score <= 2)
    .map((s) => `Can you tell us more about your experience with "${criteria.find((c) => c.id === s.criterion_id)!.name}"? The resume gives limited evidence (open question, not a disqualifier).`);
  if (!open_questions.length) open_questions.push('What was the hardest trade-off you made in your most recent project, and what would you change?');
  const total = criteria_scores.reduce((a, s, i) => a + s.score * criteria[i].weight, 0) / criteria.reduce((a, c) => a + 5 * c.weight, 0);
  const pct = total * 100 + Math.min(tasteHits, 5);
  const recommendation: Rec = pct >= 60 ? 'advance' : pct >= 35 ? 'hold' : 'reject';
  return {
    criteria_scores,
    open_questions,
    summary: `[mock] Matched ${criteria_scores.filter((s) => s.score >= 3).length} of ${criteria.length} criteria with clear evidence; ${open_questions.length} open question(s) remain.`,
    recommendation,
  };
}

export function mockPlan(criteria: Criterion[], openQuestions: string[], lowest: string[]): PlanQuestion[] {
  const out: PlanQuestion[] = [];
  const ids = [...lowest, ...criteria.map((c) => c.id)];
  openQuestions.slice(0, 4).forEach((q, i) => {
    const cid = ids[i % ids.length];
    out.push({ question: q.replace(/\s*\(open question.*$/, ''), probes_criterion_id: cid, strong_answer_looks_like: 'Gives a concrete, recent example with their own role, the decision made, and the measurable outcome.' });
  });
  let i = 0;
  while (out.length < 6) {
    const c = criteria[i % criteria.length];
    out.push({
      question: `Walk us through a specific time you demonstrated "${c.name}". What was your part, and what was the result?`,
      probes_criterion_id: c.id,
      strong_answer_looks_like: `Specific situation, clear personal ownership, trade-offs considered, and a result tied to ${c.name.toLowerCase()}.`,
    });
    i++;
  }
  return out.slice(0, 10);
}

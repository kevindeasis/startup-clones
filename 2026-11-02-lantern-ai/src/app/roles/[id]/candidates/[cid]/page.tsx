import Link from 'next/link';
import { notFound } from 'next/navigation';
import * as repo from '@/lib/repo';
import { ActionButton } from '@/app/components/ui';
import DecisionForm from '@/app/components/DecisionForm';

export const dynamic = 'force-dynamic';
const recColor: Record<string, string> = { advance: 'bg-green-100 text-green-800', hold: 'bg-amber-100 text-amber-800', reject: 'bg-red-100 text-red-800' };

export default async function CandidatePage({ params }: { params: Promise<{ id: string; cid: string }> }) {
  const { id, cid } = await params;
  const c = repo.getCandidate(cid); if (!c || c.role_id !== id) notFound();
  const review = repo.currentReview(cid, id);
  const model = review ? repo.getModelById(review.hiring_model_id) : null;
  const decision = repo.latestDecision(cid);
  const plan = repo.latestPlan(cid);
  const crit = (cid2: string) => model?.criteria.find((x) => x.id === cid2);
  return (
    <div className="space-y-6">
      <Link className="text-sm text-blue-700 hover:underline" href={`/roles/${id}`}>&larr; Pipeline</Link>
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold">{c.name}</h1>
        {review && <span className={`badge ${recColor[review.recommendation]}`}>{review.recommendation}</span>}
        {review && <span className="text-lg font-semibold">{review.overall_score.toFixed(1)}/100</span>}
        {model && <span className="text-xs text-stone-500">reviewed against model v{model.version}</span>}
      </div>
      <details className="card"><summary className="cursor-pointer font-medium">Resume text{c.source_filename ? ` (${c.source_filename})` : ''}</summary>
        <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap text-xs">{c.resume_text}</pre></details>
      {review && model && (
        <div className="card space-y-3">
          <h2 className="h2">Application review</h2>
          <p className="text-sm">{review.summary}</p>
          <table className="w-full">
            <thead><tr><th>Criterion (weight, type)</th><th>Score</th><th>Evidence</th><th>Confidence</th></tr></thead>
            <tbody>
              {review.criteria_scores.map((s) => {
                const cr = crit(s.criterion_id);
                return (
                  <tr key={s.criterion_id} className="border-t border-stone-100">
                    <td><div className="font-medium">{cr?.name ?? s.criterion_id}</div><div className="text-xs text-stone-500">w{cr?.weight} / {cr?.type}</div></td>
                    <td>{s.score}/5</td><td className="text-stone-700">{s.evidence}</td><td>{s.confidence}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div>
            <div className="text-xs font-semibold uppercase text-stone-500">Open questions (gaps to ask about, not proof)</div>
            <ul className="list-disc pl-5 text-sm">{review.open_questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
          </div>
        </div>
      )}
      <div className="card space-y-2">
        <h2 className="h2">Decision</h2>
        {decision && <p className="text-sm">Current: <b>{decision.decision as string}</b> - {decision.reason as string}</p>}
        <DecisionForm candidateId={cid} />
      </div>
      <div className="card space-y-3">
        <div className="flex items-center justify-between"><h2 className="h2">Interview plan</h2>
          <ActionButton url={`/api/candidates/${cid}/interview-plan`} ghost>Generate interview plan</ActionButton></div>
        {plan ? (
          <ol className="list-decimal space-y-3 pl-5 text-sm">
            {plan.questions.map((q: { question: string; probes_criterion_id: string; strong_answer_looks_like: string }, i: number) => (
              <li key={i}><div className="font-medium">{q.question}</div>
                <div className="text-xs text-stone-500">Probes: {crit(q.probes_criterion_id)?.name ?? q.probes_criterion_id}</div>
                <div className="text-xs">Strong answer: {q.strong_answer_looks_like}</div></li>
            ))}
          </ol>
        ) : <p className="text-sm text-stone-500">No plan yet.</p>}
      </div>
    </div>
  );
}

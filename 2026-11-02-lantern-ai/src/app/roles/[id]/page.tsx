import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import * as repo from '@/lib/repo';
import { ActionButton } from '@/app/components/ui';
import CandidateIntake from '@/app/components/CandidateIntake';
import AskChat from '@/app/components/AskChat';
import { ModelView } from '@/app/components/ModelView';

export const dynamic = 'force-dynamic';
const recColor: Record<string, string> = { advance: 'bg-green-100 text-green-800', hold: 'bg-amber-100 text-amber-800', reject: 'bg-red-100 text-red-800' };

export default async function RolePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const role = repo.getRole(id); if (!role) notFound();
  const model = repo.latestApproved(id);
  if (!model) redirect(`/roles/${id}/setup`);
  const pending = repo.pendingProposal(id);
  const rows = repo.listCandidates(id).map((c) => {
    const r = repo.currentReview(c.id, id);
    return { c, r, d: repo.latestDecision(c.id), v: r ? repo.getModelById(r.hiring_model_id)?.version : null };
  });
  const messages = repo.listMessages(id).map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content as string }));
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{role.title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <ActionButton url={`/api/roles/${id}/model/propose`} ghost>Update hiring model from decisions</ActionButton>
          <ActionButton url={`/api/roles/${id}/rereview`} ghost>Re-review all</ActionButton>
          <Link className="btn-ghost" href={`/roles/${id}/model`}>Model history{pending ? ' (1 pending)' : ''}</Link>
        </div>
      </div>
      {pending && <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">A proposed Hiring Model v{pending.version} is waiting. <Link className="font-medium underline" href={`/roles/${id}/model`}>Review the diff</Link></div>}
      <div className="card overflow-x-auto">
        <h2 className="h2">Pipeline</h2>
        <table className="w-full">
          <thead><tr><th>Candidate</th><th>Score</th><th>Recommendation</th><th>Decision</th><th>Model</th></tr></thead>
          <tbody>
            {rows.map(({ c, r, d, v }) => (
              <tr key={c.id} className="border-t border-stone-100">
                <td><Link className="font-medium text-blue-700 hover:underline" href={`/roles/${id}/candidates/${c.id}`}>{c.name}</Link></td>
                <td>{r ? r.overall_score.toFixed(1) : '-'}</td>
                <td>{r && <span className={`badge ${recColor[r.recommendation]}`}>{r.recommendation}</span>}</td>
                <td>{d ? `${d.decision}` : '-'}</td>
                <td>{v ? `v${v}` : '-'}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5} className="text-stone-500">No candidates yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <CandidateIntake roleId={id} />
        <div className="card"><h2 className="h2">Hiring model v{model.version}</h2><ModelView model={model} /></div>
      </div>
      <AskChat roleId={id} initial={messages} />
    </div>
  );
}

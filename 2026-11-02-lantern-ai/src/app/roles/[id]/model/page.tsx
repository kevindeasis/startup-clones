import Link from 'next/link';
import { notFound } from 'next/navigation';
import * as repo from '@/lib/repo';
import { ModelView, ProposalDiff } from '@/app/components/ModelView';
import ProposalActions from '@/app/components/ProposalActions';

export const dynamic = 'force-dynamic';

export default async function ModelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const role = repo.getRole(id); if (!role) notFound();
  const latest = repo.latestApproved(id);
  const pending = repo.pendingProposal(id);
  const all = repo.listModels(id).filter((m) => !(m.status === 'proposed' && m.id !== pending?.id));
  return (
    <div className="space-y-6">
      <Link className="text-sm text-blue-700 hover:underline" href={`/roles/${id}`}>&larr; {role.title}</Link>
      <h1 className="text-xl font-bold">Hiring model history</h1>
      {pending && latest && (
        <div className="card space-y-3 border-amber-300">
          <h2 className="h2">Pending proposal: v{pending.version} (current v{latest.version})</h2>
          <ProposalDiff prev={latest} next={pending} />
          <ProposalActions roleId={id} proposalId={pending.id} />
        </div>
      )}
      {all.map((m) => (
        <details key={m.id} className="card" open={m.id === latest?.id}>
          <summary className="cursor-pointer font-medium">v{m.version} <span className="badge ml-2 bg-stone-100">{m.status}</span> <span className="text-xs text-stone-400">{m.created_at.slice(0, 16)}</span></summary>
          <p className="my-2 text-sm text-stone-600">{m.change_summary || '(no summary)'}</p>
          <ModelView model={m} />
        </details>
      ))}
    </div>
  );
}

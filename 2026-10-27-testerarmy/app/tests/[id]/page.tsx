import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db';
import { StatusBadge } from '@/components/StatusBadge';
import { RunButton } from '@/components/RunButton';

export const dynamic = 'force-dynamic';

export default async function TestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  const t = db.data.tests.find((x) => x.id === id);
  if (!t) notFound();
  const runs = db.data.runs.filter((r) => r.testId === id).reverse();
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t.name}</h1>
          <p className="text-sm text-neutral-500">{t.startUrl}</p>
        </div>
        <RunButton testId={t.id} label="Run now" />
      </div>
      <section className="rounded border border-neutral-200 bg-white p-4">
        <h2 className="mb-2 font-medium">Steps</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm">{t.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
        <h2 className="mb-1 mt-4 font-medium">Expected outcome</h2>
        <p className="text-sm">{t.expectedOutcome || '—'}</p>
      </section>
      <section>
        <h2 className="mb-2 font-medium">Runs</h2>
        <div className="rounded border border-neutral-200 bg-white">
          {runs.length === 0 && <p className="p-4 text-sm text-neutral-500">No runs yet.</p>}
          {runs.map((r) => (
            <Link key={r.id} href={`/runs/${r.id}`} className="flex items-center justify-between border-b border-neutral-100 p-3 text-sm last:border-0 hover:bg-neutral-50">
              <span className="font-mono">{r.id}</span>
              <StatusBadge status={r.status} />
              <span className="text-neutral-500">{r.planner}</span>
              <span className="text-neutral-500">{r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : '—'}</span>
              <span className="text-neutral-500">{r.startedAt ? new Date(r.startedAt).toLocaleString() : 'queued'}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

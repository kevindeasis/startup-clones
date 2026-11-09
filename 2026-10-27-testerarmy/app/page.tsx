import Link from 'next/link';
import { getDb } from '@/lib/db';
import { plannerKind } from '@/lib/agent';
import { StatusBadge } from '@/components/StatusBadge';
import { RunButton } from '@/components/RunButton';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const db = await getDb();
  const kind = plannerKind();
  const rows = db.data.tests.map((t) => {
    const runs = db.data.runs.filter((r) => r.testId === t.id);
    return { t, last: runs[runs.length - 1], count: runs.length };
  });
  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Tests</h1>
          <span
            data-testid="planner-badge"
            className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs ${kind === 'anthropic' ? 'bg-purple-100 text-purple-800' : 'bg-yellow-100 text-yellow-800'}`}
          >
            {kind === 'anthropic' ? 'LLM: Anthropic' : 'Mock planner — set ANTHROPIC_API_KEY'}
          </span>
        </div>
        <Link href="/tests/new" className="rounded bg-neutral-900 px-3 py-2 text-sm text-white hover:bg-neutral-700">New test</Link>
      </div>
      <div className="overflow-x-auto rounded border border-neutral-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-neutral-500">
            <tr><th className="p-3">Name</th><th className="p-3">URL</th><th className="p-3">Last run</th><th className="p-3">When</th><th className="p-3">Runs</th><th className="p-3"></th></tr>
          </thead>
          <tbody>
            {rows.map(({ t, last, count }) => (
              <tr key={t.id} className="border-b border-neutral-100 last:border-0">
                <td className="p-3"><Link className="font-medium hover:underline" href={`/tests/${t.id}`}>{t.name}</Link></td>
                <td className="p-3 text-neutral-500">{t.startUrl}</td>
                <td className="p-3">
                  {last ? <Link href={`/runs/${last.id}`}><StatusBadge status={last.status} /></Link> : <StatusBadge />}
                </td>
                <td className="p-3 text-neutral-500">{last?.startedAt ? new Date(last.startedAt).toLocaleString() : '—'}</td>
                <td className="p-3">{count}</td>
                <td className="p-3 text-right"><RunButton testId={t.id} /></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="p-6 text-neutral-500" colSpan={6}>No tests yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

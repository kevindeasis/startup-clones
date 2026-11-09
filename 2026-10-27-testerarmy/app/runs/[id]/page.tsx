'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Run, Test } from '@/lib/types';
import { StatusBadge } from '@/components/StatusBadge';

const art = (p: string) => `/api/artifacts/${p}`;

function describeAction(a: Run['steps'][number]['actions'][number]['action']) {
  switch (a.type) {
    case 'goto': return `goto ${a.url}`;
    case 'click': return `click "${a.target}"`;
    case 'fill': return `fill "${a.target}" with "${a.value}"`;
    case 'press': return `press ${a.key}`;
    case 'select': return `select "${a.value}" in "${a.target}"`;
    case 'scroll': return `scroll ${a.direction}`;
    case 'wait': return `wait ${a.ms}ms`;
    case 'assert_text': return `assert text "${a.text}"`;
    case 'assert_url_contains': return `assert url contains "${a.fragment}"`;
    case 'done': return `done${a.summary ? ': ' + a.summary : ''}`;
    case 'fail': return `fail: ${a.reason}`;
  }
}

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [run, setRun] = useState<Run | null>(null);
  const [test, setTest] = useState<Test | null>(null);
  const [big, setBig] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const res = await fetch(`/api/runs/${id}`, { cache: 'no-store' });
      if (res.status === 404) return setMissing(true);
      const r: Run = await res.json();
      if (stop) return;
      setRun(r);
      if (r.status === 'queued' || r.status === 'running') timer = setTimeout(tick, 2000);
    };
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [id]);

  useEffect(() => {
    if (!run) return;
    fetch(`/api/tests/${run.testId}`).then((r) => (r.ok ? r.json() : null)).then(setTest);
  }, [run?.testId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (missing) return <p>Run not found.</p>;
  if (!run) return <p className="text-neutral-500">Loading…</p>;
  const live = run.status === 'queued' || run.status === 'running';

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/tests/${run.testId}`} className="text-sm text-neutral-500 hover:underline">← {test?.name ?? run.testId}</Link>
        <div className="mt-1 flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Run <span className="font-mono">{run.id}</span></h1>
          <span data-testid="run-status"><StatusBadge status={run.status} /></span>
          {live && <span className="text-sm text-neutral-500">updating…</span>}
        </div>
        <p className="text-sm text-neutral-500">
          planner: {run.planner}
          {run.durationMs != null && ` · ${(run.durationMs / 1000).toFixed(1)}s`}
          {run.startedAt && ` · ${new Date(run.startedAt).toLocaleString()}`}
        </p>
      </div>

      {run.verdictReason && <p className="rounded border border-neutral-200 bg-white p-3 text-sm"><b>Verdict:</b> {run.verdictReason}</p>}
      {run.error && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800"><b>Error:</b> {run.error}</p>}

      <section className="space-y-3">
        <h2 className="font-medium">Timeline</h2>
        {run.steps.map((s) => (
          <div key={s.index} className="rounded border border-neutral-200 bg-white p-4" data-testid="step">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">{s.index + 1}. {s.instruction}</p>
              <StatusBadge status={s.status} />
            </div>
            <ul className="mt-3 space-y-3">
              {s.actions.map((a, j) => (
                <li key={j} className="flex gap-3 text-sm" data-testid="action">
                  {a.screenshotPath && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={art(a.screenshotPath)} alt={`step ${s.index + 1} action ${j + 1}`} onClick={() => setBig(art(a.screenshotPath!))} className="h-20 w-32 shrink-0 cursor-zoom-in rounded border border-neutral-200 object-cover object-top" />
                  )}
                  <div>
                    <p><span className={a.ok ? 'text-green-700' : 'text-red-700'}>{a.ok ? '✓' : '✗'}</span> <code>{describeAction(a.action)}</code> <span className="text-neutral-400">{a.tookMs}ms</span></p>
                    {a.reasoning && <p className="text-neutral-500">{a.reasoning}</p>}
                    {a.error && <p className="text-red-700">{a.error}</p>}
                    {a.urlAfter && <p className="text-xs text-neutral-400">{a.urlAfter}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      {run.finalScreenshotPath && (
        <section>
          <h2 className="mb-2 font-medium">Final screenshot</h2>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={art(run.finalScreenshotPath)} alt="final screenshot" onClick={() => setBig(art(run.finalScreenshotPath!))} className="max-h-96 cursor-zoom-in rounded border border-neutral-200" />
        </section>
      )}
      {run.videoPath && (
        <section>
          <h2 className="mb-2 font-medium">Video</h2>
          <video src={art(run.videoPath)} controls className="max-w-full rounded border border-neutral-200" />
        </section>
      )}

      {big && (
        <div className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center overflow-auto bg-black/80 p-6" onClick={() => setBig(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={big} alt="enlarged screenshot" className="max-h-full max-w-full" />
        </div>
      )}
    </div>
  );
}

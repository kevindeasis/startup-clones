'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function RunButton({ testId, label = 'Run' }: { testId: string; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const res = await fetch(`/api/tests/${testId}/run`, { method: 'POST' });
        const { runId } = await res.json();
        router.push(`/runs/${runId}`);
      }}
      className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-700 disabled:opacity-50"
    >
      {busy ? 'Starting…' : label}
    </button>
  );
}

'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from './ui';

export default function DecisionForm({ candidateId }: { candidateId: string }) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function decide(decision: 'advance' | 'reject') {
    setBusy(true); setErr('');
    try { await api(`/api/candidates/${candidateId}/decision`, { decision, reason }); setReason(''); router.refresh(); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }
  return (
    <div className="space-y-2">
      <textarea className="input h-20" placeholder="Why? (short reason, this teaches the hiring model)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="flex gap-2">
        <button className="btn" disabled={busy || !reason.trim()} onClick={() => decide('advance')}>Advance</button>
        <button className="btn-ghost" disabled={busy || !reason.trim()} onClick={() => decide('reject')}>Reject</button>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
    </div>
  );
}

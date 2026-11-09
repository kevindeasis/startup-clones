'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from './ui';

export default function CandidateIntake({ roleId }: { roleId: string }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function go(fn: () => Promise<unknown>) {
    setBusy(true); setErr('');
    try { await fn(); setText(''); setName(''); router.refresh(); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }
  return (
    <div className="card space-y-3">
      <h2 className="h2">Add candidates</h2>
      <label className="block text-sm">Upload resumes (PDF or .txt)
        <input className="mt-1 block text-sm" type="file" multiple accept=".pdf,.txt,.md,text/plain,application/pdf" disabled={busy}
          onChange={(e) => {
            const files = Array.from(e.target.files || []); if (!files.length) return;
            const fd = new FormData(); files.forEach((f) => fd.append('files', f));
            go(() => api(`/api/roles/${roleId}/candidates`, undefined, fd));
          }} />
      </label>
      <div className="space-y-2">
        <input className="input" placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
        <textarea className="input h-24" placeholder="...or paste resume text" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn" disabled={busy || !text.trim()} onClick={() => go(() => api(`/api/roles/${roleId}/candidates`, { name: name || undefined, resume_text: text }))}>
          {busy ? 'Reviewing...' : 'Add and review'}
        </button>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
    </div>
  );
}

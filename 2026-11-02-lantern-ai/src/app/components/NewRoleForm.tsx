'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from './ui';

export default function NewRoleForm() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [jd, setJd] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <form className="card space-y-3" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setErr('');
      try { const r = await api('/api/roles', { title, job_description: jd }); router.push(`/roles/${r.role.id}/setup`); }
      catch (x) { setErr((x as Error).message); setBusy(false); }
    }}>
      <h2 className="h2">New role</h2>
      <input className="input" placeholder="Role title" value={title} onChange={(e) => setTitle(e.target.value)} required />
      <textarea className="input h-40" placeholder="Paste the job description..." value={jd} onChange={(e) => setJd(e.target.value)} required />
      <button className="btn" disabled={busy}>{busy ? 'Drafting rubric...' : 'Create role and draft hiring bar'}</button>
      {err && <p className="text-sm text-red-600">{err}</p>}
    </form>
  );
}

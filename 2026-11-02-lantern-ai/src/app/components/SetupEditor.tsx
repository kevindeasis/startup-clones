'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from './ui';

type C = { id: string; name: string; description: string; weight: number; type: string };

export default function SetupEditor({ roleId, initial }: { roleId: string; initial: C[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<C[]>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (i: number, patch: Partial<C>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="card space-y-3">
      <table className="w-full">
        <thead><tr><th>Name</th><th>Description</th><th>Weight</th><th>Type</th><th /></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id}>
              <td><input className="input" value={r.name} onChange={(e) => set(i, { name: e.target.value })} /></td>
              <td><textarea className="input h-16" value={r.description} onChange={(e) => set(i, { description: e.target.value })} /></td>
              <td><input className="input w-16" type="number" min={1} max={5} value={r.weight} onChange={(e) => set(i, { weight: Math.max(1, Math.min(5, Number(e.target.value) || 1)) })} /></td>
              <td>
                <select className="input" value={r.type} onChange={(e) => set(i, { type: e.target.value })}>
                  <option value="must_have">must_have</option><option value="nice_to_have">nice_to_have</option><option value="dealbreaker">dealbreaker</option>
                </select>
              </td>
              <td><button className="btn-ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex gap-2">
        <button className="btn-ghost" onClick={() => setRows([...rows, { id: `c${Date.now().toString(36)}`, name: '', description: '', weight: 3, type: 'nice_to_have' }])}>Add criterion</button>
        <button className="btn" disabled={busy || !rows.length || rows.some((r) => !r.name.trim())} onClick={async () => {
          setBusy(true); setErr('');
          try { await api(`/api/roles/${roleId}/model`, { criteria: rows }); router.push(`/roles/${roleId}`); } catch (e) { setErr((e as Error).message); setBusy(false); }
        }}>{busy ? 'Saving...' : 'Save as Hiring Model'}</button>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
    </div>
  );
}

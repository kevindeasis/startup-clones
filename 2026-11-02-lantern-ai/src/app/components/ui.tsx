'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export async function api(url: string, body?: unknown, form?: FormData) {
  const res = await fetch(url, form ? { method: 'POST', body: form } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

/** Button that POSTs to an endpoint, then refreshes server data. */
export function ActionButton({ url, body, children, ghost, confirm, then }: { url: string; body?: unknown; children: React.ReactNode; ghost?: boolean; confirm?: string; then?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <span className="inline-flex items-center gap-2">
      <button className={ghost ? 'btn-ghost' : 'btn'} disabled={busy} onClick={async () => {
        if (confirm && !window.confirm(confirm)) return;
        setBusy(true); setErr('');
        try { await api(url, body); if (then) router.push(then); else router.refresh(); } catch (e) { setErr((e as Error).message); }
        setBusy(false);
      }}>{busy ? 'Working...' : children}</button>
      {err && <span className="text-sm text-red-600">{err}</span>}
    </span>
  );
}

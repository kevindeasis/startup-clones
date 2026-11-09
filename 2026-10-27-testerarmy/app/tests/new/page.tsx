'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const SAMPLE = {
  name: 'Login and add a todo (sample)',
  startUrl: 'http://localhost:3000/demo',
  steps: [
    'Type "demo" into the "Username" field',
    'Type "demo123" into the "Password" field',
    'Click the "Sign in" button',
    'Type "Buy milk" into the "New todo" field',
    'Click the "Add" button',
    'Verify that "Buy milk" is visible',
  ].join('\n'),
  expectedOutcome: 'The page contains "1 items left"',
};

export default function NewTest() {
  const router = useRouter();
  const [f, setF] = useState(SAMPLE);
  const [err, setErr] = useState('');
  const set = (k: keyof typeof SAMPLE) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const input = 'w-full rounded border border-neutral-300 bg-white px-3 py-2 text-sm';
  return (
    <form
      className="max-w-2xl space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await fetch('/api/tests', { method: 'POST', body: JSON.stringify(f), headers: { 'content-type': 'application/json' } });
        const data = await res.json();
        if (!res.ok) return setErr(data.error);
        router.push(`/tests/${data.id}`);
      }}
    >
      <h1 className="text-2xl font-semibold">New test</h1>
      <label className="block text-sm">Name<input className={input} value={f.name} onChange={set('name')} /></label>
      <label className="block text-sm">Start URL<input className={input} value={f.startUrl} onChange={set('startUrl')} /></label>
      <label className="block text-sm">Steps (one per line)<textarea rows={8} className={input + ' font-mono'} value={f.steps} onChange={set('steps')} /></label>
      <label className="block text-sm">Expected outcome<textarea rows={2} className={input} value={f.expectedOutcome} onChange={set('expectedOutcome')} /></label>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <button className="rounded bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700">Create test</button>
    </form>
  );
}

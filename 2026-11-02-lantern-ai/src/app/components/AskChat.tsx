'use client';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';

type M = { role: 'user' | 'assistant'; content: string };

export default function AskChat({ roleId, initial }: { roleId: string; initial: M[] }) {
  const [msgs, setMsgs] = useState<M[]>(initial);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  async function send() {
    const question = q.trim(); if (!question) return;
    setQ(''); setBusy(true);
    setMsgs((m) => [...m, { role: 'user', content: question }, { role: 'assistant', content: '' }]);
    try {
      const res = await fetch(`/api/roles/${roleId}/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }) });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
      const reader = res.body.getReader(); const dec = new TextDecoder(); let acc = '';
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        acc += dec.decode(value, { stream: true });
        setMsgs((m) => [...m.slice(0, -1), { role: 'assistant', content: acc }]);
      }
    } catch (e) {
      setMsgs((m) => [...m.slice(0, -1), { role: 'assistant', content: `Error: ${(e as Error).message}` }]);
    }
    setBusy(false);
  }
  return (
    <div className="card space-y-3">
      <h2 className="h2">Ask the pipeline</h2>
      <div className="max-h-96 space-y-3 overflow-y-auto">
        {msgs.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
            <div className={`inline-block max-w-[90%] rounded-lg px-3 py-2 text-left text-sm ${m.role === 'user' ? 'bg-stone-900 text-white' : 'bg-stone-100'}`}>
              {m.role === 'user' ? m.content : <div className="prose-sm [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5 [&_p]:my-1"><ReactMarkdown>{m.content || '...'}</ReactMarkdown></div>}
            </div>
          </div>
        ))}
        {!msgs.length && <p className="text-sm text-stone-500">Try: &quot;Who are my top 3 and why?&quot; or &quot;Which criterion is rejecting the most people?&quot;</p>}
      </div>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask a question about this pipeline..." />
        <button className="btn" disabled={busy || !q.trim()}>Ask</button>
      </form>
    </div>
  );
}

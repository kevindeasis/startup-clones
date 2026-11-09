import type { HiringModel } from '@/lib/repo';

export function ModelView({ model }: { model: HiringModel }) {
  return (
    <div className="space-y-2">
      <table className="w-full">
        <thead><tr><th>Criterion</th><th>Type</th><th>Weight</th></tr></thead>
        <tbody>
          {model.criteria.map((c) => (
            <tr key={c.id} className="border-t border-stone-100">
              <td><div className="font-medium">{c.name}</div><div className="text-xs text-stone-500">{c.description}</div></td>
              <td>{c.type}</td><td>{c.weight}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {model.taste_notes.length > 0 && (
        <div><div className="text-xs font-semibold uppercase text-stone-500">Taste notes</div>
          <ul className="list-disc pl-5 text-sm">{model.taste_notes.map((n, i) => <li key={i}>{n}</li>)}</ul></div>
      )}
    </div>
  );
}

export function ProposalDiff({ prev, next }: { prev: HiringModel; next: HiringModel }) {
  const prevById = new Map(prev.criteria.map((c) => [c.id, c]));
  const nextIds = new Set(next.criteria.map((c) => c.id));
  return (
    <div className="space-y-3 text-sm">
      <p><b>Change summary:</b> {next.change_summary}</p>
      <table className="w-full">
        <thead><tr><th>Criterion</th><th>Before</th><th>After</th></tr></thead>
        <tbody>
          {next.criteria.map((c) => {
            const o = prevById.get(c.id);
            const changed = !o || o.weight !== c.weight || o.name !== c.name || o.description !== c.description || o.type !== c.type;
            return (
              <tr key={c.id} className={changed ? 'bg-amber-50' : ''}>
                <td className="font-medium">{c.name}{!o && <span className="badge ml-2 bg-green-100 text-green-800">new</span>}</td>
                <td>{o ? `${o.name !== c.name ? o.name + ' - ' : ''}w${o.weight} ${o.type}${o.description !== c.description ? ' (description changed)' : ''}` : '-'}</td>
                <td>w{c.weight} {c.type}</td>
              </tr>
            );
          })}
          {prev.criteria.filter((c) => !nextIds.has(c.id)).map((c) => (
            <tr key={c.id} className="bg-red-50"><td className="font-medium line-through">{c.name}</td><td>w{c.weight} {c.type}</td><td>removed</td></tr>
          ))}
        </tbody>
      </table>
      <div className="grid grid-cols-2 gap-4">
        <div><div className="text-xs font-semibold uppercase text-stone-500">Taste notes before</div><ul className="list-disc pl-5">{prev.taste_notes.map((n, i) => <li key={i}>{n}</li>)}{!prev.taste_notes.length && <li className="list-none text-stone-400">none</li>}</ul></div>
        <div><div className="text-xs font-semibold uppercase text-stone-500">Taste notes after</div><ul className="list-disc pl-5">{next.taste_notes.map((n, i) => <li key={i} className={prev.taste_notes.includes(n) ? '' : 'bg-amber-50'}>{n}</li>)}</ul></div>
      </div>
    </div>
  );
}

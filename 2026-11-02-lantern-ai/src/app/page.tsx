import Link from 'next/link';
import { listRoles } from '@/lib/repo';
import NewRoleForm from './components/NewRoleForm';

export const dynamic = 'force-dynamic';

export default function Home() {
  const roles = listRoles();
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="card">
        <h2 className="h2">Roles</h2>
        {roles.length === 0 && <p className="text-sm text-stone-500">No roles yet. Create one to define your hiring bar.</p>}
        <ul className="divide-y divide-stone-100">
          {roles.map((r) => (
            <li key={r.id} className="py-2"><Link className="font-medium text-blue-700 hover:underline" href={`/roles/${r.id}`}>{r.title}</Link>
              <span className="ml-2 text-xs text-stone-400">{String(r.created_at).slice(0, 10)}</span></li>
          ))}
        </ul>
      </div>
      <NewRoleForm />
    </div>
  );
}

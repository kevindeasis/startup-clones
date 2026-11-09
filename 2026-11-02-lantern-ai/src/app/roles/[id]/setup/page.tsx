import { notFound, redirect } from 'next/navigation';
import * as repo from '@/lib/repo';
import SetupEditor from '@/app/components/SetupEditor';

export const dynamic = 'force-dynamic';

export default async function Setup({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const role = repo.getRole(id); if (!role) notFound();
  if (repo.latestApproved(id)) redirect(`/roles/${id}`);
  const draft = repo.pendingDraft(id);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{role.title}: define the hiring bar</h1>
      <p className="text-sm text-stone-600">Drafted from the job description. Edit, add or remove criteria, then save as Hiring Model v1.</p>
      <SetupEditor roleId={id} initial={draft?.criteria ?? []} />
    </div>
  );
}

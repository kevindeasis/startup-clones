import { readDb } from "@/lib/store";
import { KickoffForm } from "@/components/client";

export const dynamic = "force-dynamic";

export default function NewProject() {
  const accounts = readDb().accounts.map((a) => ({ id: a.id, name: a.name }));
  return (
    <>
      <h1>New onboarding project</h1>
      <p className="muted">Paste a kickoff call transcript. Speaker lines look like <code>Name (Company, Role): text</code>.</p>
      <div className="card"><KickoffForm accounts={accounts} /></div>
    </>
  );
}

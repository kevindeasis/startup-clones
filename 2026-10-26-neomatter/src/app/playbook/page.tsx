import { db, playbookClauses } from "@/db";
import { saveClause, deleteClause } from "../actions";
import { PRACTICE_AREAS } from "@/lib/schemas";

export const dynamic = "force-dynamic";

function ClauseForm({ c }: { c?: typeof playbookClauses.$inferSelect }) {
  return (
    <form action={saveClause} className="grid gap-2 text-sm md:grid-cols-2">
      <div><label className="label">ID</label><input name="id" defaultValue={c?.id} readOnly={!!c} required placeholder="PB-XXX-01" className="input" /></div>
      <div><label className="label">Practice area</label>
        <select name="practice_area" defaultValue={c?.practiceArea ?? "commercial"} className="input">{PRACTICE_AREAS.map((a) => <option key={a}>{a}</option>)}</select></div>
      <div className="md:col-span-2"><label className="label">Title</label><input name="title" defaultValue={c?.title} required className="input" /></div>
      <div><label className="label">Standard position</label><textarea name="standard_position" defaultValue={c?.standardPosition} rows={3} className="input" /></div>
      <div><label className="label">Fallback</label><textarea name="fallback_position" defaultValue={c?.fallbackPosition} rows={3} className="input" /></div>
      <div><label className="label">Walk-away</label><textarea name="walk_away" defaultValue={c?.walkAway} rows={2} className="input" /></div>
      <div><label className="label">Approver</label><input name="approver" defaultValue={c?.approver} className="input" /></div>
      <div><button className="btn btn-primary" type="submit">{c ? "Save" : "Add clause"}</button></div>
    </form>
  );
}

export default function PlaybookPage() {
  const clauses = db.select().from(playbookClauses).all();
  const groups = [...new Set(clauses.map((c) => c.practiceArea))].sort();
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Playbook</h1>
      {groups.map((g) => (
        <section key={g} className="space-y-3">
          <h2 className="sec">{g}</h2>
          {clauses.filter((c) => c.practiceArea === g).map((c) => (
            <article key={c.id} id={`clause-${c.id}`} className="card target:ring-2 target:ring-indigo-500">
              <div className="mb-1 flex items-center justify-between">
                <h3 className="font-medium"><span className="badge mr-2">{c.id}</span>{c.title}</h3>
                <form action={deleteClause}><input type="hidden" name="id" value={c.id} /><button className="btn btn-danger" type="submit">Delete</button></form>
              </div>
              <dl className="text-sm text-stone-700">
                <p><b>Standard:</b> {c.standardPosition}</p>
                <p><b>Fallback:</b> {c.fallbackPosition}</p>
                <p><b>Walk-away:</b> {c.walkAway}</p>
                <p><b>Approver:</b> {c.approver}</p>
              </dl>
              <details className="mt-2"><summary className="cursor-pointer text-sm text-indigo-700">Edit</summary><div className="mt-2"><ClauseForm c={c} /></div></details>
            </article>
          ))}
        </section>
      ))}
      <section className="card"><h2 className="sec">Add clause</h2><ClauseForm /></section>
    </div>
  );
}

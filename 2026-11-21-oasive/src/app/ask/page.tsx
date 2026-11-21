import { AskCompare } from "@/components/AskCompare";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function AskPage() {
  const obligors = await store.listObligors();
  return (
    <>
      <div>
        <h1>Ask</h1>
        <p className="muted">Ask a question of one obligor, or pick two to compare answers side by side. Answers cite document pages.</p>
      </div>
      {obligors.length === 0 ? (
        <div className="panel">No data yet. Run <code>npm run seed</code>.</div>
      ) : (
        <div className="panel">
          <AskCompare obligors={obligors.map((o) => ({ id: o.id, name: o.name }))} />
        </div>
      )}
    </>
  );
}

import { Directory } from "@/components/Directory";
import { obligorSummaries, ensureDefaultWatchlist } from "@/lib/service";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [rows, lists] = await Promise.all([obligorSummaries(), ensureDefaultWatchlist()]);
  const starred = lists.find((w) => w.id === "default")?.obligorIds ?? [];
  return (
    <>
      <div>
        <h1>Obligor directory</h1>
        <p className="muted">
          Fictional municipal borrowers with sourced financials, flagged events and cited Q&amp;A. Star an obligor to add it to the default watchlist.
        </p>
      </div>
      {rows.length === 0 ? (
        <div className="panel">No data yet. Run <code>npm run seed</code> or POST /api/seed.</div>
      ) : (
        <div className="panel">
          <Directory rows={rows} starred={starred} />
        </div>
      )}
    </>
  );
}

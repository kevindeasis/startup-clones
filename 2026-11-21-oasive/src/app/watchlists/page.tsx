import { WatchlistsClient } from "@/components/WatchlistsClient";
import { watchlistDetails } from "@/lib/service";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function WatchlistsPage() {
  const [lists, obligors] = await Promise.all([watchlistDetails(), store.listObligors()]);
  return (
    <>
      <div>
        <h1>Watchlists</h1>
        <p className="muted">Group obligors, see the combined events feed and the count of high-severity events in the last 30 days.</p>
      </div>
      <WatchlistsClient lists={lists} all={obligors.map((o) => ({ id: o.id, name: o.name }))} />
    </>
  );
}

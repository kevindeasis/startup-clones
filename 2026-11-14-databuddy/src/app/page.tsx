import Link from "next/link";
import { CreateSiteForm, SeedButton } from "@/components/home-forms";
import { Card, MockBanner } from "@/components/ui";
import { isMockMode } from "@/lib/llm";
import { listSites } from "@/lib/repo";

export const dynamic = "force-dynamic";

export default function Home() {
  const sites = listSites();
  return (
    <div className="space-y-6">
      {isMockMode() && <MockBanner />}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Cookieless analytics with an AI analyst</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Install one script, see your traffic, and ask Bunny questions in plain language. It shows the SQL it ran so you can check the number.
        </p>
      </div>
      <Card title="Your sites">
        {sites.length === 0 ? (
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm">No sites yet. Create one below, or load 30 days of demo data.</p>
            <SeedButton />
          </div>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {sites.map((s) => (
              <li key={s.id}>
                <Link href={`/sites/${s.id}`} className="flex items-center justify-between py-3 hover:text-[var(--accent)]">
                  <span className="font-medium">{s.name}</span>
                  <span className="text-sm text-[var(--muted)]">{s.domain}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Create a site">
        <CreateSiteForm />
      </Card>
    </div>
  );
}

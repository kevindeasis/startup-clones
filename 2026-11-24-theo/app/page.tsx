import Link from "next/link";
import { listSites } from "@/lib/store";
export const dynamic = "force-dynamic";

export default async function Home() {
  const sites = await listSites();
  return (
    <div className="space-y-8">
      <section className="py-8">
        <h1 className="text-4xl font-bold tracking-tight">The site-builder and engine that gets your business found.</h1>
        <p className="mt-3 max-w-2xl text-slate-600">Answer a few questions, pick a design direction, and get a full local-business website. Edit it by chat. Run the growth agent to draft SEO pages and fixes. Or audit any site for free.</p>
        <div className="mt-5 flex gap-3"><Link className="btn" href="/new">Build a site</Link><Link className="btn-ghost" href="/audit">Free audit</Link></div>
      </section>
      <section>
        <h2 className="mb-3 text-lg font-semibold">Your sites</h2>
        {sites.length === 0 ? <p className="text-sm text-slate-500">No sites yet.</p> : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sites.map((s) => (
              <li key={s.id} className="card">
                <Link href={`/sites/${s.id}`} className="font-semibold hover:underline">{s.business.name}</Link>
                <p className="text-sm text-slate-500">{s.business.industry} &middot; {s.business.city}, {s.business.region}</p>
                <p className="mt-1 text-xs text-slate-400">{s.pages.length} pages &middot; <a className="underline" href={`/s/${s.slug}`} target="_blank">/s/{s.slug}</a></p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

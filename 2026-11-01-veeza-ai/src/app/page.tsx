import Link from "next/link";
import { DESTINATIONS } from "@/lib/destinations";

export default function Home() {
  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <h1 className="text-4xl font-bold tracking-tight">Tell us the destination. We&apos;ll prep your visa.</h1>
        <p className="max-w-2xl text-slate-600">
          Pick a destination, upload your passport, check your supporting documents with AI, get a readiness score,
          and download pre-filled forms for review.
        </p>
        <div className="flex gap-3">
          <Link href="/quiz" className="btn">Check how strong your application is</Link>
          <Link href="/apply/new" className="btn-secondary">Start an application</Link>
        </div>
      </section>
      <section>
        <h2 className="mb-3 text-xl font-semibold">Choose a destination</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {DESTINATIONS.map((d) => (
            <Link key={d.code} href={`/apply/new?destination=${d.code}`} className="card block hover:border-indigo-400">
              <div className="flex items-baseline justify-between">
                <span className="text-lg font-semibold">{d.name}</span>
                <span className="text-xs text-slate-500">{d.code}</span>
              </div>
              <p className="mt-1 text-sm text-slate-600">{d.visaType}</p>
              <p className="mt-3 text-sm">
                <span className="font-semibold">${d.feeUSD}</span> <span className="text-slate-500">illustrative service fee / person</span>
              </p>
            </Link>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500">Requirements are illustrative and must be confirmed with the embassy/visa centre.</p>
      </section>
    </div>
  );
}

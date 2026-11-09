import Link from "next/link";
import NewContract from "@/components/NewContract";
import { listContracts } from "@/lib/repo";
import { money } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function Home() {
  const contracts = listContracts();
  return (
    <div className="grid gap-6 md:grid-cols-3">
      <section className="md:col-span-2">
        <h1 className="mb-3 text-xl font-semibold">Contracts</h1>
        {contracts.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
            No contracts yet. Upload one or load the sample contract to get started.
          </p>
        ) : (
          <ul className="space-y-3">
            {contracts.map((c) => (
              <li key={c.id}>
                <Link href={`/contracts/${c.id}`} className="block rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:border-emerald-500">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="font-medium">{c.payer}</div>
                      <div className="text-sm text-slate-500">{c.name}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-slate-500">Total underpaid</div>
                      <div className="text-lg font-semibold text-red-600">{money(c.total_underpaid_amount)}</div>
                    </div>
                  </div>
                  <div className="mt-2 flex gap-4 text-xs text-slate-500">
                    <span>{c.terms_count} terms</span>
                    <span>{c.total} claims</span>
                    <span>{c.underpaid} underpaid</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <NewContract />
    </div>
  );
}

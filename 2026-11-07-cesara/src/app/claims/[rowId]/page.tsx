import { notFound } from "next/navigation";
import Link from "next/link";
import ClaimActions from "@/components/ClaimActions";
import { getClaim, getContract, latestAppeal } from "@/lib/repo";
import { money } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ClaimPage({ params }: { params: Promise<{ rowId: string }> }) {
  const { rowId } = await params;
  const row = getClaim(rowId);
  if (!row) notFound();
  const contract = getContract(row.contract_id);
  const clause = contract?.terms.terms.find((t) => t.id === row.clause_ref);
  return (
    <div className="space-y-4">
      <Link href={`/contracts/${row.contract_id}`} className="text-sm text-slate-500 hover:underline">
        &larr; {contract?.payer ?? "Contract"}
      </Link>
      <div>
        <h1 className="text-xl font-semibold">Claim {row.claim_id}</h1>
        <p className="text-sm text-slate-500">
          {row.service_date} &middot; {row.code_type} {row.code} &middot; {row.description} &middot; patient ref {row.patient_ref}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Billed", money(row.billed_charges)],
          ["Expected (contract)", money(row.expected_amount)],
          ["Paid", money(row.paid_amount)],
          ["Variance", money(row.variance)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="text-xs text-slate-500">{k}</div>
            <div className="text-lg font-semibold">{v}</div>
          </div>
        ))}
      </div>
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-1 text-sm font-semibold">How the expected amount was computed</h2>
        <div className="mb-2">
          <span className="inline-block rounded bg-slate-100 px-2 py-0.5 text-xs font-medium">{row.flag}</span>
        </div>
        <p className="text-sm text-slate-700">{row.reason}</p>
      </section>
      {clause && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-1 text-sm font-semibold">Contract clause ({clause.id})</h2>
          <blockquote className="border-l-4 border-emerald-500 pl-3 text-sm italic text-slate-700">{clause.source_clause}</blockquote>
        </section>
      )}
      <ClaimActions rowId={row.id} initialStatus={row.status} flag={row.flag} initialLetter={latestAppeal(rowId)} />
    </div>
  );
}

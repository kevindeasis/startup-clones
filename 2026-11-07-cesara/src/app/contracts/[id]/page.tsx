import { notFound } from "next/navigation";
import Link from "next/link";
import ContractTabs from "@/components/ContractTabs";
import { getContract } from "@/lib/repo";

export const dynamic = "force-dynamic";

export default async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = getContract(id);
  if (!c) notFound();
  const t = c.terms;
  return (
    <div>
      <Link href="/" className="text-sm text-slate-500 hover:underline">&larr; All contracts</Link>
      <div className="mb-4 mt-1">
        <h1 className="text-xl font-semibold">{t.payer}</h1>
        <p className="text-sm text-slate-500">
          {t.contract_name} &middot; Provider: {t.provider} &middot; Effective {t.effective_date}
          {t.end_date ? ` to ${t.end_date}` : ""}
        </p>
      </div>
      <ContractTabs contractId={id} terms={t} />
    </div>
  );
}

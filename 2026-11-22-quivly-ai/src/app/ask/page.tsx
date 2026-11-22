import Link from "next/link";
import { readDb } from "@/lib/store";
import { AskBox } from "@/components/client";

export const dynamic = "force-dynamic";

export default async function AskPage({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  const q = await searchParams;
  const db = readDb();
  const acc = db.accounts.find((a) => a.id === q.account);
  return (
    <>
      <h1>Ask PostSale</h1>
      <p className="muted">Pick an account, then ask a question. Answers cite the account&apos;s notes, tickets, invoices, tasks, signals and metrics.</p>
      <form className="filters" method="get">
        <div><label htmlFor="aa">Account</label>
          <select id="aa" name="account" defaultValue={q.account ?? ""}><option value="">Choose…</option>{db.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
        <button>Select</button>
      </form>
      {acc ? <div className="card"><h2>{acc.name}</h2><AskBox accountId={acc.id} /><p className="small muted">Sources are listed on the <Link href={`/accounts/${acc.id}`}>Customer 360</Link>.</p></div> : <div className="card">Choose an account above.</div>}
    </>
  );
}

import Link from "next/link";
import { agencySummaries } from "@/lib/agencies";
import { money } from "../components/ui";

export const dynamic = "force-dynamic";

export default async function AgenciesPage() {
  const rows = await agencySummaries();
  return (
    <>
      <h1>Agencies</h1>
      <p className="sub">Fictional agencies with seeded award history.</p>
      <table>
        <thead><tr><th>Agency</th><th>Type</th><th>Region</th><th>Documents</th><th>Signals</th><th>3-year spend</th></tr></thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id}>
              <td><Link href={`/agencies/${a.id}`}>{a.name}</Link></td>
              <td>{a.type}</td>
              <td>{a.region}</td>
              <td>{a.documents}</td>
              <td>{a.signals}</td>
              <td>{money(a.spend3y)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

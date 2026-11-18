"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Application } from "@/lib/types";

export default function Staff() {
  const [apps, setApps] = useState<Application[] | null>(null);
  const load = useCallback(async () => setApps(await fetch("/api/applications").then((r) => r.json())), []);
  useEffect(() => {
    fetch("/api/applications").then((r) => r.json()).then(setApps);
  }, []);
  async function seed() {
    await fetch("/api/seed", { method: "POST" });
    load();
  }
  return (
    <div>
      <h1>Staff dashboard</h1>
      {apps && apps.length === 0 && <button onClick={seed}>Seed sample applications</button>}
      {apps && apps.length > 0 && (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>ID</th><th>Permit</th><th>Address</th><th>Applicant</th><th>Status</th><th>Created</th><th></th></tr></thead>
            <tbody>
              {apps.map((a) => (
                <tr key={a.id}>
                  <td>{a.id}</td><td>{a.permitType}</td><td>{a.address}</td><td>{a.applicant.name}</td>
                  <td><span className="pill">{a.status}</span></td>
                  <td>{a.createdAt.slice(0, 10)}</td>
                  <td><Link href={`/staff/${a.id}`}>Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!apps && <p>Loading…</p>}
    </div>
  );
}

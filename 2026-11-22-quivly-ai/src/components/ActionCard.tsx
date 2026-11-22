import Link from "next/link";
import type { Action } from "@/lib/types";
import { ActionButtons } from "./client";
import { ActionBadges } from "./ui";

export function ActionCard({ a, accountName }: { a: Action; accountName?: string }) {
  return (
    <div className="card" id={`item-${a.id}`}>
      <div className="row"><ActionBadges a={a} />{a.degraded && <span className="badge">degraded</span>}</div>
      <h3 style={{ marginTop: 6 }}>{accountName && <><Link href={`/accounts/${a.accountId}`}>{accountName}</Link> — </>}{a.title}</h3>
      <p>{a.rationale}</p>
      <ul style={{ margin: ".2rem 0 .6rem", paddingLeft: "1.2rem" }}>{a.nextSteps.map((s, i) => <li key={i}>{s}</li>)}</ul>
      {a.status === "open" ? <ActionButtons id={a.id} /> : <span className="badge">{a.status}{a.snoozedUntil ? ` until ${a.snoozedUntil}` : ""}</span>}
    </div>
  );
}

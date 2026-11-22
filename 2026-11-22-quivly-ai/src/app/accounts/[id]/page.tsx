import Link from "next/link";
import { notFound } from "next/navigation";
import { readDb } from "@/lib/store";
import { get360 } from "@/lib/view";
import { WEIGHTS } from "@/lib/health";
import { money } from "@/lib/util";
import { ActionCard } from "@/components/ActionCard";
import { AskBox, BriefButton, CopyButton, KickoffForm, TaskToggle, UsageUpload } from "@/components/client";
import { HealthBadge, Markdown, UsageChart } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Account360({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = get360(readDb(), id);
  if (!v) notFound();
  const { account: a, stats: s } = v;
  const h = a.health;
  const drop = v.openActions.some((x) => x.type === "usage_drop");
  const i = h?.inputs ?? {};
  const parts: { key: keyof typeof WEIGHTS; label: string; detail: string }[] = [
    { key: "usageTrend", label: "Usage trend", detail: `${i.recentAvgUnits} vs ${i.priorAvgUnits} units/wk (${i.usageChangePct}%)` },
    { key: "adoptionBreadth", label: "Adoption breadth", detail: `${i.seatsActivePct}% of ${a.seats} seats active` },
    { key: "supportLoad", label: "Support load", detail: `${i.tickets4w} tickets in 4 wks, ${i.openTickets} open` },
    { key: "billing", label: "Billing", detail: i.overdueInvoices ? `${i.overdueInvoices} overdue, max ${i.maxDaysOverdue}d` : "no overdue invoices" },
    { key: "engagementRecency", label: "Engagement", detail: `last contact ${i.daysSinceContact} days ago` },
  ];
  const latestBrief = v.briefs.at(-1);
  const openDeals = v.projects;
  return (
    <>
      <p className="small"><Link href="/">← Portfolio</Link></p>
      <div className="card">
        <div className="row"><h1 style={{ margin: 0 }}>{a.name}</h1><HealthBadge score={h?.score} band={h?.band} /></div>
        <p className="muted">{a.segment} · {a.plan} plan · {a.stage} · ARR {money(a.arr)} · {a.seats} seats</p>
        <p className="small">Contract {a.contractStart} → renews <strong>{a.renewalDate}</strong> ({v.daysToRenewal} days) · Owner {a.owner} · Champion {a.champion.name}, {a.champion.title} ({a.champion.email})</p>
        {h && <p><strong>Why:</strong> {h.why}</p>}
      </div>

      <div className="grid2">
        <div className="card" id="usage">
          <h2>Usage (last 12 weeks)</h2>
          <UsageChart usage={v.usage} quota={a.quotaUnitsPerWeek} drop={drop} />
          <p className="small muted">Bars: metered units (red = detected drop, last 2 weeks vs prior 4); orange line: weekly active users; dashed: plan quota. Latest week at {v.quotaPct}% of quota; last 2 weeks avg {Math.round(s.recentAvg)} vs prior 4 weeks {Math.round(s.priorAvg)} ({Math.round(-s.dropPct)}%).</p>
          <UsageUpload accountId={a.id} />
        </div>
        <div className="card" id="health">
          <h2>Health breakdown</h2>
          {parts.map((p) => (
            <div key={p.key}>
              <div className="row" style={{ justifyContent: "space-between", gap: 8 }}><span>{p.label} <span className="muted small">({Math.round(WEIGHTS[p.key] * 100)}%)</span></span><strong className="score">{h?.parts[p.key] ?? "–"}</strong></div>
              <div className="partbar"><i style={{ width: `${h?.parts[p.key] ?? 0}%` }} /></div>
              <div className="muted small">{p.detail}</div>
            </div>
          ))}
          {v.snapshots.length > 1 && <p className="small muted" style={{ marginTop: 8 }}>Trend: {v.snapshots.map((x) => x.score).join(" → ")}</p>}
        </div>
      </div>

      <h2>Open actions</h2>
      {v.openActions.length ? v.openActions.map((x) => <ActionCard key={x.id} a={x} />) : <div className="card muted">No open actions.</div>}

      <div className="card" id="projects">
        <h2>Projects</h2>
        {openDeals.length === 0 && <p className="muted">No projects yet.</p>}
        {openDeals.map((p) => (
          <div key={p.id} id={`item-${p.id}`} style={{ marginBottom: 14 }}>
            <div className="row"><strong>{p.title}</strong><span className="badge">{p.kind.replace("_", " ")}</span><span className="muted small">{p.createdAt.slice(0, 10)} · {p.tasks.filter((t) => t.done).length}/{p.tasks.length} done</span></div>
            {p.goals.length > 0 && <><h3>Goals</h3><ul>{p.goals.map((g, k) => <li key={k}>{g}</li>)}</ul></>}
            <h3>Tasks</h3>
            <ul className="tasks">
              {p.tasks.map((t) => (
                <TaskToggle key={t.id} id={t.id} done={t.done} title={t.title}>
                  {t.isBlocker && <span className="badge blocker">blocker</span>}
                  <span className="muted small" id={`item-${t.id}`}>{t.ownerSide}{t.ownerName ? ` · ${t.ownerName}` : ""} · due {t.dueAt}</span>
                </TaskToggle>
              ))}
            </ul>
            {p.stakeholders.length > 0 && <p className="small muted">Stakeholders: {p.stakeholders.map((x) => `${x.name} (${x.role}, ${x.side})`).join("; ")}</p>}
            {p.risks.length > 0 && <p className="small muted">Risks: {p.risks.join("; ")}</p>}
            {p.recap && <><pre className="recap">{p.recap}</pre><CopyButton text={p.recap} /></>}
          </div>
        ))}
        <h3>Create onboarding project from a kickoff transcript</h3>
        <KickoffForm accountId={a.id} />
      </div>

      <div className="card" id="renewal">
        <h2>Renewal brief</h2>
        <BriefButton accountId={a.id} />
        {latestBrief && (
          <div id={`item-${latestBrief.id}`} style={{ marginTop: 10 }}>
            <p className="small muted">Drafted {latestBrief.createdAt.slice(0, 10)} · proposed {money(latestBrief.ask.proposedArr)} / {latestBrief.ask.termMonths} months{latestBrief.degraded ? " · degraded" : ""}</p>
            <Markdown text={latestBrief.markdown} />
          </div>
        )}
      </div>

      <div className="card" id="signals">
        <h2>Signals</h2>
        {v.signals.length === 0 && <p className="muted">No Radar signals for this account.</p>}
        {v.signals.map((x) => (
          <p key={x.id}><span className={`badge ${x.direction === "risk" ? "high" : x.direction === "expansion" ? "green" : ""}`}>{x.direction}</span> <strong>{x.title}</strong> <span className="muted small">{x.publishedAt}</span><br />{x.summary}</p>
        ))}
      </div>

      <div className="card" id="ask">
        <h2>Ask about {a.name}</h2>
        <div id={`item-${a.id}`} className="small muted" style={{ marginBottom: 6 }}>Context: metrics card, {v.notes.length} notes, {v.tickets.length} tickets, {v.invoices.length} invoices, tasks, signals, briefs.</div>
        <AskBox accountId={a.id} />
      </div>

      <div className="card" id="timeline">
        <h2>Timeline</h2>
        <ul className="timeline">
          {v.timeline.map((t) => (
            <li key={`${t.kind}-${t.id}`} id={`item-${t.id}`}>
              <span className="badge">{t.kind}</span> <strong>{t.title}</strong> <span className="muted small">{t.at}</span>
              {t.body && <div className="small muted" style={{ whiteSpace: "pre-wrap" }}>{t.body.length > 400 ? `${t.body.slice(0, 400)}…` : t.body}</div>}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

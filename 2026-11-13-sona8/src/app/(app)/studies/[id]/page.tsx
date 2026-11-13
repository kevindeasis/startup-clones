import Link from "next/link";
import { notFound } from "next/navigation";
import AddParticipantForm from "../../../../components/AddParticipantForm";
import CopyButton from "../../../../components/CopyButton";
import MermaidView from "../../../../components/MermaidView";
import SynthesiseButton from "../../../../components/SynthesiseButton";
import * as repo from "../../../../lib/repo";
import type { StudySynthesis } from "../../../../lib/schemas";

export const dynamic = "force-dynamic";

const th = "px-3 py-2 text-left text-xs font-medium uppercase text-slate-500";
const td = "px-3 py-2 align-top text-sm";
const card = "rounded border bg-white p-4";

/** Group pain points by team, then by site. */
function groupPainPoints(points: StudySynthesis["painPoints"]) {
  const byTeam = new Map<string, Map<string, StudySynthesis["painPoints"]>>();
  for (const p of points) {
    for (const team of p.teams.length ? p.teams : ["Unassigned"]) {
      const sites = byTeam.get(team) ?? new Map();
      for (const site of p.sites.length ? p.sites : ["Unspecified site"]) sites.set(site, [...(sites.get(site) ?? []), p]);
      byTeam.set(team, sites);
    }
  }
  return byTeam;
}

export default async function StudyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const study = repo.getStudy(id);
  if (!study) notFound();
  const participants = repo.listParticipants(id);
  const stored = repo.getSynthesis(id);
  const s = stored?.synthesis;
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const completed = participants.filter((p) => p.status === "completed").length;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">{study.title}</h1>
        <p className="text-slate-600">{study.topic}</p>
        {study.goal && <p className="mt-1 text-sm text-slate-500">Goal: {study.goal}</p>}
      </div>

      <section className={card}>
        <h2 className="mb-3 font-medium">Participants</h2>
        <table className="mb-4 w-full">
          <thead><tr><th className={th}>Participant</th><th className={th}>Team / site</th><th className={th}>Status</th><th className={th}>Invite link</th><th className={th}>Results</th></tr></thead>
          <tbody className="divide-y">
            {participants.map((p) => {
              const link = `${base}/interview/${p.token}`;
              return (
                <tr key={p.id}>
                  <td className={td}>{p.name || "Anonymous"}<div className="text-xs text-slate-500">{p.role}</div></td>
                  <td className={td}>{[p.team, p.site].filter(Boolean).join(" / ") || "-"}</td>
                  <td className={td}><span data-testid="status">{p.status}</span></td>
                  <td className={td}><code className="text-xs">/interview/{p.token}</code> <CopyButton text={link} /></td>
                  <td className={td}>{p.status !== "invited" && <Link className="text-indigo-600 underline" href={`/studies/${id}/interviews/${p.id}`}>Transcript</Link>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <AddParticipantForm studyId={id} teams={study.teams} />
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-medium">Synthesis</h2>
          <SynthesiseButton studyId={id} disabled={completed === 0} />
          {s && (
            <>
              <a className="rounded border px-2 py-1 text-sm" href={`/api/studies/${id}/context.md`} download={`${study.title}-context.md`}>Download context.md</a>
              <a className="rounded border px-2 py-1 text-sm" href={`/api/studies/${id}/context.json`} download={`${study.title}-context.json`}>Download context.json</a>
            </>
          )}
        </div>
        {!s || !stored ? (
          <p className="text-sm text-slate-500">{completed === 0 ? "Complete at least one interview, then synthesise." : "Press Synthesise to build the process map."}</p>
        ) : (
          <>
            <p className="text-sm text-slate-600">{s.headline} <span className="text-slate-400">({stored.interviewCount} interviews, model {stored.model})</span></p>
            <MermaidView source={stored.mermaid} />

            <div className={`${card} overflow-x-auto`}>
              <h3 className="mb-2 font-medium">Steps</h3>
              <table className="w-full">
                <thead><tr><th className={th}>Step</th><th className={th}>Owner role</th><th className={th}>Tools</th><th className={th}>Manual?</th><th className={th}>Mentioned by</th></tr></thead>
                <tbody className="divide-y">
                  {s.mergedSteps.map((m) => (
                    <tr key={m.id}><td className={td}>{m.name}</td><td className={td}>{m.actorRole}</td><td className={td}>{m.tools.join(", ") || "-"}</td><td className={td}>{m.manual ? "Yes" : "No"}</td><td className={td}>{m.mentionedBy}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={card}>
              <h3 className="mb-2 font-medium">Pain points</h3>
              {[...groupPainPoints(s.painPoints)].map(([team, sites]) => (
                <div key={team} className="mb-4">
                  <h4 className="font-medium text-slate-800">{team}</h4>
                  {[...sites].map(([site, points]) => (
                    <div key={site} className="ml-3 mt-1">
                      <div className="text-xs uppercase text-slate-500">{site}</div>
                      <ul className="space-y-2">
                        {points.map((p, i) => (
                          <li key={i} className="text-sm">
                            <span className="mr-2 rounded bg-slate-200 px-1.5 text-xs">{p.severity}</span>{p.description} <span className="text-slate-500">(x{p.count})</span>
                            <blockquote className="ml-2 border-l-2 pl-2 text-xs italic text-slate-500">“{p.quote}”</blockquote>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            <div className={card}>
              <h3 className="mb-2 font-medium">Exceptions</h3>
              <ul className="list-disc pl-5 text-sm">{s.exceptions.map((e, i) => <li key={i}>{e.condition} <span className="text-slate-500">(x{e.mentionedBy})</span></li>)}</ul>
            </div>

            <div className={card}>
              <h3 className="mb-2 font-medium">Recommendations</h3>
              <ul className="space-y-2 text-sm">
                {s.recommendations.map((r, i) => (
                  <li key={i}><span className="mr-2 rounded bg-indigo-100 px-1.5 text-xs text-indigo-800">{r.type}</span><b>{r.title}</b> — {r.rationale} <span className="text-slate-500">[{r.stepIds.join(", ")}]</span></li>
                ))}
              </ul>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

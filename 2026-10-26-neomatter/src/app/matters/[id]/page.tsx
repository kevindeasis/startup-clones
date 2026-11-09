import Link from "next/link";
import { notFound } from "next/navigation";
import { inArray } from "drizzle-orm";
import { db, lawyers, playbookClauses, precedents } from "@/db";
import { getMatter } from "@/lib/matters";
import { matterAction } from "../../actions";

export const dynamic = "force-dynamic";

function Cite({ ids }: { ids: string[] }) {
  if (!ids.length) return <span className="text-xs text-stone-400">no citation</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {ids.map((id) =>
        id.startsWith("PB-") ? (
          <Link key={id} href={`/playbook#clause-${id}`} className="badge text-indigo-700 hover:underline">{id}</Link>
        ) : (
          <a key={id} href={`#cite-${id}`} className="badge text-emerald-700 hover:underline">{id}</a>
        ),
      )}
    </span>
  );
}

export default async function MatterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = getMatter(id);
  if (!data) notFound();
  const { matter: m, request: r, owner, events } = data;
  const b = m.brief;
  const allLawyers = db.select().from(lawyers).all();
  const citeIds = b.citations_used;
  const clauseRows = citeIds.length ? db.select().from(playbookClauses).where(inArray(playbookClauses.id, citeIds)).all() : [];
  const precRows = citeIds.length ? db.select().from(precedents).where(inArray(precedents.id, citeIds)).all() : [];
  const chosen = m.chosenOption ?? "";
  const open = m.status !== "approved" && m.status !== "closed";

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.6fr]">
      {/* Left: original request */}
      <section className="space-y-3">
        <Link href="/" className="text-sm text-stone-500 hover:underline">← All matters</Link>
        <div className="card space-y-2">
          <h2 className="sec">Original request</h2>
          <div className="flex items-center gap-2 text-sm">
            <span className="badge">{r.channel}</span>
            <span>{r.requesterName}</span>
            {r.requesterEmail && <span className="text-stone-500">&lt;{r.requesterEmail}&gt;</span>}
          </div>
          <div className="font-medium">{r.subject}</div>
          <p className="whitespace-pre-wrap text-sm">{r.body}</p>
          {r.attachments.map((a) => (
            <details key={a.name} className="rounded border border-stone-200 p-2 text-sm">
              <summary className="cursor-pointer font-medium">Attachment: {a.name}</summary>
              <pre className="mt-2 whitespace-pre-wrap font-mono text-xs">{a.text}</pre>
            </details>
          ))}
        </div>
        {m.clarifyingMessage && (
          <div className="card">
            <h2 className="sec">Clarifying message (drafted)</h2>
            <p className="whitespace-pre-wrap text-sm">{m.clarifyingMessage}</p>
          </div>
        )}
        <div className="card">
          <h2 className="sec">Activity</h2>
          <ol className="space-y-1 text-sm">
            {events.map((e) => (
              <li key={e.id}><span className="text-xs text-stone-500">{new Date(e.createdAt).toISOString().slice(0, 16).replace("T", " ")}</span> {e.type.replaceAll("_", " ")}</li>
            ))}
          </ol>
        </div>
      </section>

      {/* Right: work product */}
      <section className="space-y-4">
        <div className="card space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold">{m.title}</h1>
            <span className="badge">{m.status.replaceAll("_", " ")}</span>
            <span className="badge">{m.urgency}</span>
          </div>
          <h2 className="sec">Brief</h2>
          <p className="text-sm">{b.summary}</p>
          <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
            <dt className="text-stone-500">Ask</dt><dd>{b.ask}</dd>
            <dt className="text-stone-500">Practice area</dt><dd>{m.practiceArea}</dd>
            <dt className="text-stone-500">Urgency</dt><dd>{b.urgency} — {b.urgency_reason}</dd>
            <dt className="text-stone-500">Owner</dt><dd>{owner?.name ?? "Unassigned"}</dd>
            <dt className="text-stone-500">Waiting on</dt><dd>{m.waitingOn ?? "-"}</dd>
            <dt className="text-stone-500">Missing info</dt>
            <dd>{b.missing_info.length ? <ul className="list-disc pl-4">{b.missing_info.map((x) => <li key={x}>{x}</li>)}</ul> : "None"}</dd>
            <dt className="text-stone-500">Key terms</dt>
            <dd>{b.key_terms.length ? b.key_terms.map((t, i) => <span key={i} className="badge mr-1">{t.label}: {t.value}</span>) : "-"}</dd>
            <dt className="text-stone-500">Dates</dt>
            <dd>{b.dates.length ? b.dates.map((t, i) => <span key={i} className="badge mr-1">{t.label}: {t.date}</span>) : "-"}</dd>
          </dl>
        </div>

        {b.decision_required && (
          <div className="card space-y-2">
            <h2 className="sec">Decision</h2>
            <p className="text-sm font-medium">{b.decision.question}</p>
            <form action={matterAction} className="space-y-2">
              <input type="hidden" name="id" value={m.id} />
              <input type="hidden" name="action" value="choose_option" />
              {b.decision.options.map((o) => {
                const rec = o.label === b.decision.recommended_label;
                return (
                  <label key={o.label} className={`block rounded border p-2 text-sm ${rec ? "border-indigo-400 bg-indigo-50" : "border-stone-200"}`}>
                    <input type="radio" name="chosen_option" value={o.label} defaultChecked={chosen ? chosen === o.label : rec} className="mr-2" />
                    <span className="font-medium">{o.label}</span>{rec && <span className="badge ml-2">recommended</span>}
                    <div className="ml-5 text-stone-700">{o.rationale}</div>
                    <div className="ml-5 text-stone-500">Risk: {o.risk}</div>
                    <div className="ml-5 mt-1"><Cite ids={o.citations} /></div>
                  </label>
                );
              })}
              <button className="btn" type="submit">Save choice</button>
            </form>
          </div>
        )}

        <div className="card overflow-x-auto">
          <h2 className="sec">Redline</h2>
          {b.redline.length ? (
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-stone-500"><tr><th className="pr-2">Clause</th><th className="pr-2">Issue</th><th className="pr-2">Proposed language</th><th>Cite</th></tr></thead>
              <tbody>
                {b.redline.map((x, i) => (
                  <tr key={i} className="border-t border-stone-100 align-top">
                    <td className="py-2 pr-2 italic text-red-800">“{x.clause_quote}”</td>
                    <td className="py-2 pr-2">{x.issue}</td>
                    <td className="py-2 pr-2 text-green-800">{x.proposed_language}</td>
                    <td className="py-2"><Cite ids={x.citations} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-sm text-stone-500">No attached contract text to redline.</p>}
        </div>

        <div className="card space-y-2">
          <h2 className="sec">Draft reply</h2>
          <form action={matterAction} className="space-y-2">
            <input type="hidden" name="id" value={m.id} />
            <textarea name="draft_reply" defaultValue={m.draftReply} rows={9} className="input" />
            <div className="flex flex-wrap gap-2">
              <button className="btn" type="submit" name="action" value="save_reply">Save edit</button>
              {open && <button className="btn btn-primary" type="submit" name="action" value="approve">Approve &amp; mark sent</button>}
            </div>
          </form>
          <p className="text-xs text-stone-500">Nothing is actually sent; a lawyer would press Send in the real channel.</p>
        </div>

        <div className="card">
          <h2 className="sec">Citations</h2>
          {clauseRows.length + precRows.length === 0 && <p className="text-sm text-stone-500">None.</p>}
          <div className="space-y-2">
            {clauseRows.map((c) => (
              <details key={c.id} className="rounded border border-stone-200 p-2 text-sm">
                <summary className="cursor-pointer"><span className="font-medium">{c.id}</span> {c.title}</summary>
                <p className="mt-1">Standard: {c.standardPosition}</p>
                <p>Fallback: {c.fallbackPosition}</p>
                <p>Walk-away: {c.walkAway}</p>
                <Link href={`/playbook#clause-${c.id}`} className="text-indigo-700 underline">Open in playbook</Link>
              </details>
            ))}
            {precRows.map((p) => (
              <details key={p.id} id={`cite-${p.id}`} className="rounded border border-stone-200 p-2 text-sm">
                <summary className="cursor-pointer"><span className="font-medium">{p.id}</span> precedent</summary>
                <p className="mt-1">{p.summary}</p><p>{p.outcome}</p>
                <Link href={`/matters/${p.matterId}`} className="text-indigo-700 underline">Open matter</Link>
              </details>
            ))}
          </div>
        </div>

        <div className="card space-y-3">
          <h2 className="sec">Actions</h2>
          <div className="flex flex-wrap items-end gap-3">
            <form action={matterAction}>
              <input type="hidden" name="id" value={m.id} />
              <button className="btn" name="action" value="request_info" type="submit">Request more info</button>
            </form>
            <form action={matterAction} className="flex items-end gap-2">
              <input type="hidden" name="id" value={m.id} /><input type="hidden" name="action" value="reassign" />
              <select name="owner_id" defaultValue={m.ownerId ?? ""} className="input w-44">
                {allLawyers.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
              <button className="btn" type="submit">Reassign</button>
            </form>
            <form action={matterAction}>
              <input type="hidden" name="id" value={m.id} />
              <button className="btn btn-danger" name="action" value="close" type="submit">Close</button>
            </form>
          </div>
        </div>
      </section>
    </div>
  );
}

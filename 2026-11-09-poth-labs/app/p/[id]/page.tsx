"use client";
import { use, useCallback, useEffect, useState } from "react";

type Json = any; // API payloads are loosely typed on the client

const post = (url: string, body?: object) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) }).then(async (r) => {
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "request failed");
    return j;
  });

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<Json>(null);
  const [tab, setTab] = useState("hypotheses");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [csv, setCsv] = useState("");
  const [tickets, setTickets] = useState("");
  const [calls, setCalls] = useState("");
  const [accountId, setAccountId] = useState("");

  const load = useCallback(() => fetch(`/api/projects/${id}`).then((r) => r.json()).then(setData), [id]);
  useEffect(() => { load(); }, [load]);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true); setMsg("");
    try { await fn(); setMsg(ok); await load(); } catch (e) { setMsg("Error: " + (e as Error).message); }
    setBusy(false);
  }
  const readFile = (set: (s: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (f) f.text().then(set);
  };

  if (!data) return <p className="mut">Loading...</p>;
  if (data.error) return <p className="err">{data.error}</p>;
  const { project, accounts, evidence, hypotheses, interviews } = data;
  const accName = (aid: number | null) => accounts.find((a: Json) => a.id === aid)?.name ?? "anonymous";

  return (
    <>
      <h1>{project.name}</h1>
      <div className="mut">Research question: <b>{project.question}</b></div>
      <div className="tabs">
        {["data", "hypotheses", "interviews", "accounts"].map((t) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>
        ))}
      </div>
      {msg && <p className={msg.startsWith("Error") ? "err" : "mut"}>{msg}</p>}

      {tab === "data" && (
        <>
          <p className="mut">{accounts.length} accounts, {evidence.length} evidence rows ({evidence.filter((e: Json) => e.kind === "ticket").length} tickets, {evidence.filter((e: Json) => e.kind === "call").length} calls)</p>
          <div className="card">
            <b>Accounts / usage CSV</b> <span className="mut">(needs account_id column; a CSV with an event column is treated as usage events)</span>
            <input type="file" accept=".csv,text/csv" onChange={readFile(setCsv)} />
            <textarea value={csv} onChange={(e) => setCsv(e.target.value)} placeholder="account_id,name,plan,logins_30d..." />
          </div>
          <div className="card">
            <b>Support tickets</b> <span className="mut">(separate entries with a blank line; prefix [account_id] to link)</span>
            <input type="file" accept=".txt,text/plain" onChange={readFile(setTickets)} />
            <textarea value={tickets} onChange={(e) => setTickets(e.target.value)} />
          </div>
          <div className="card">
            <b>Call notes</b>
            <input type="file" accept=".txt,text/plain" onChange={readFile(setCalls)} />
            <textarea value={calls} onChange={(e) => setCalls(e.target.value)} />
          </div>
          <button disabled={busy || (!csv && !tickets && !calls)} onClick={() => run(async () => {
            await post(`/api/projects/${id}/import`, { csv, tickets, calls }); setCsv(""); setTickets(""); setCalls("");
          }, "Imported.")}>Import</button>
          <h2>Evidence</h2>
          <table><tbody>
            {evidence.map((e: Json) => <tr key={e.id}><td>#{e.id}</td><td><span className="tag">{e.kind}</span></td><td>{e.text}</td></tr>)}
          </tbody></table>
        </>
      )}

      {tab === "hypotheses" && (
        <>
          <button disabled={busy} onClick={() => run(() => post(`/api/projects/${id}/hypotheses`), "Hypotheses generated.")}>
            {hypotheses.length ? "Regenerate hypotheses (resets confidence)" : "Generate hypotheses"}
          </button>
          {hypotheses.length === 0 && <p className="mut">No hypotheses yet. Import data, then generate.</p>}
          {hypotheses.map((h: Json, i: number) => (
            <div className="card" key={h.id}>
              <div className="row"><b>#{i + 1}</b><span style={{ flex: 1 }}>{h.statement}</span><b>{Math.round(h.confidence * 100)}%</b></div>
              <div className="bar" style={{ margin: "6px 0" }}><i style={{ width: `${h.confidence * 100}%` }} /></div>
              <div className="mut">{h.rationale}</div>
              <div className="mut">
                Data evidence: {h.evidenceIds.length} rows{h.evidenceIds.length ? ` (${h.evidenceIds.map((e: number) => "#" + e).join(", ")})` : ""} ·{" "}
                <span className="supports">{h.supports} interview supports</span> · <span className="contradicts">{h.contradicts} contradicts</span>
              </div>
              {h.findings.map((f: Json, j: number) => (
                <blockquote key={j}><span className={f.stance}>{f.stance}</span> ({accName(f.accountId)}): &ldquo;{f.quote}&rdquo;</blockquote>
              ))}
            </div>
          ))}
        </>
      )}

      {tab === "interviews" && (
        <>
          <div className="row">
            <select style={{ width: 260 }} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Anonymous respondent</option>
              {accounts.map((a: Json) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <button disabled={busy} onClick={() => run(() => post(`/api/projects/${id}/interviews`, { accountId: accountId || undefined }), "Interview link created.")}>Create interview link</button>
          </div>
          {interviews.map((i: Json) => (
            <div className="card" key={i.id}>
              <div className="row"><b>{accName(i.accountId)}</b><span className="tag">{i.status}</span>
                <a href={`/i/${i.token}`} target="_blank">{typeof window !== "undefined" ? window.location.origin : ""}/i/{i.token}</a></div>
              <div className="mut">{i.messages.filter((m: Json) => m.role === "user").length} answers</div>
            </div>
          ))}
        </>
      )}

      {tab === "accounts" && accounts.map((a: Json) => (
        <div className="card" key={a.id}>
          <b>{a.name}</b> <span className="mut">{a.externalId}</span>
          <div className="mut">{Object.entries(a.attrs).filter(([k]) => k !== "interview_summary").map(([k, v]) => `${k}=${v}`).join(" · ")}</div>
          {evidence.filter((e: Json) => e.accountId === a.id && e.kind !== "usage").map((e: Json) => (
            <blockquote key={e.id}><span className="tag">{e.kind} #{e.id}</span> {e.text}</blockquote>
          ))}
          {a.attrs.interview_summary && <div><b>Interview answers:</b> {String(a.attrs.interview_summary)}</div>}
          {interviews.filter((i: Json) => i.accountId === a.id).map((i: Json) => (
            <details key={i.id}><summary>Transcript ({i.status})</summary>
              {i.messages.map((m: Json, k: number) => <div key={k} className="mut"><b>{m.role}:</b> {m.content}</div>)}
            </details>
          ))}
        </div>
      ))}
    </>
  );
}

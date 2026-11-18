"use client";
import { use, useCallback, useEffect, useState } from "react";
import { Checks } from "@/components/Checks";
import { Markdown } from "@/components/Markdown";
import type { Application, Status } from "@/lib/types";

export default function Detail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [app, setApp] = useState<Application | null>(null);
  const [busy, setBusy] = useState("");
  const load = useCallback(async () => {
    const r = await fetch(`/api/applications/${id}`);
    setApp(r.ok ? await r.json() : null);
  }, [id]);
  useEffect(() => {
    fetch(`/api/applications/${id}`).then((r) => (r.ok ? r.json() : null)).then(setApp);
  }, [id]);

  async function act(name: string, path: string) {
    setBusy(name);
    await fetch(`/api/applications/${id}/${path}`, { method: "POST" });
    await load();
    setBusy("");
  }
  async function setStatus(status: Status) {
    await fetch(`/api/applications/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
    load();
  }

  if (!app) return <p>Loading or not found…</p>;
  return (
    <div>
      <h1>{app.id} · {app.permitType} <span className="pill">{app.status}</span></h1>
      <div className="card">
        <p><strong>{app.address}</strong> ({app.zoning}) · {app.applicant.name} · {app.applicant.email}</p>
        <p>{app.projectDescription}</p>
        <p className="muted">Fields: {Object.entries(app.fields).map(([k, v]) => `${k}=${v}`).join(", ")}</p>
        <p className="muted">Attachments: {app.attachments.map((a) => `${a.filename} (${a.kind})`).join(", ") || "none"}</p>
      </div>
      <div className="actions">
        <button onClick={() => act("review", "review")} disabled={!!busy}>{busy === "review" ? "Reviewing…" : "Run review"}</button>
        <button className="secondary" onClick={() => act("report", "report")} disabled={!!busy || !app.review}>Draft staff report</button>
        <button className="secondary" onClick={() => setStatus("approved")}>Approve</button>
        <button className="secondary" onClick={() => setStatus("needs_info")}>Request info</button>
      </div>
      {app.review && (
        <div className="card">
          <h2>Review</h2>
          <p>{app.review.summary}</p>
          <p><strong>Recommendation:</strong> {app.review.recommendation.replace(/_/g, " ")}</p>
          <Checks checks={app.review.checks} />
          {app.review.conditions.length > 0 && <><h3>Conditions</h3><ul>{app.review.conditions.map((c, i) => <li key={i}>{c}</li>)}</ul></>}
        </div>
      )}
      {app.report && <div className="card"><Markdown source={app.report} /></div>}
    </div>
  );
}

"use client";
import { useEffect, useState } from "react";

interface Project { id: number; name: string; question: string; created_at: string }

export default function Home() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [question, setQuestion] = useState("Why are accounts churning?");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => fetch("/api/projects").then((r) => r.json()).then(setProjects);
  useEffect(() => { load(); }, []);

  async function create(body: object) {
    setBusy(true); setErr("");
    const r = await fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) return setErr(j.error);
    window.location.href = `/p/${j.id}`;
  }

  return (
    <>
      <h1>Research projects</h1>
      <p className="mut">Use your existing customer data to form hypotheses, validate them with adaptive interviews, and see what holds up.</p>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>New project</h2>
        <div className="row"><input placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="row" style={{ marginTop: 8 }}><input placeholder="Research question" value={question} onChange={(e) => setQuestion(e.target.value)} /></div>
        <div className="row" style={{ marginTop: 8 }}>
          <button disabled={busy || !name || !question} onClick={() => create({ name, question })}>Create project</button>
          <button className="sec" disabled={busy} onClick={() => create({ sample: true })}>Load sample data</button>
        </div>
        {err && <p className="err">{err}</p>}
      </div>
      <h2>Projects</h2>
      {projects.length === 0 && <p className="mut">No projects yet.</p>}
      {projects.map((p) => (
        <a key={p.id} href={`/p/${p.id}`} style={{ textDecoration: "none", color: "inherit" }}>
          <div className="card"><b>{p.name}</b><div className="mut">{p.question}</div></div>
        </a>
      ))}
    </>
  );
}

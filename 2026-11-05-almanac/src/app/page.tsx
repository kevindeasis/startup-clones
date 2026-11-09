"use client";
import { useCallback, useEffect, useState } from "react";
import { CompileButton } from "./components/CompileButton";
import { SourceDrawer, Markdown } from "./components/Markdown";
import type { Task } from "@/lib/types";

type Status = { provider: string; lastCompiledAt: string | null; sourceCount: number; pageCount: number; uncompiledCount: number };

export default function Home() {
  const [status, setStatus] = useState<Status | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [cite, setCite] = useState<number | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const load = useCallback(async () => {
    setStatus(await (await fetch("/api/status")).json());
    setTasks(await (await fetch("/api/tasks")).json());
  }, []);
  useEffect(() => { load(); }, [load]);

  const setStatusOf = async (id: string, s: Task["status"]) => {
    await fetch(`/api/tasks/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: s }) });
    load();
  };
  const open = tasks.filter((t) => t.status === "open");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Home</h1>
        <CompileButton onDone={load} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Last compiled", status?.lastCompiledAt ? new Date(status.lastCompiledAt).toLocaleString() : "never"],
          ["Sources", status?.sourceCount ?? "-"],
          ["Wiki pages", status?.pageCount ?? "-"],
          ["Uncompiled sources", status?.uncompiledCount ?? "-"],
        ].map(([k, v]) => (
          <div key={String(k)} className="card">
            <div className="text-xs uppercase tracking-wide text-slate-500">{k}</div>
            <div className="mt-1 text-lg font-semibold">{v}</div>
          </div>
        ))}
      </div>
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Suggested tasks</h2>
          <button className="btn-ghost" disabled={suggesting} onClick={async () => { setSuggesting(true); await fetch("/api/suggest", { method: "POST" }); setSuggesting(false); load(); }}>
            {suggesting ? "Thinking..." : "Suggest more"}
          </button>
        </div>
        {open.length === 0 && <p className="text-sm text-slate-500">No open tasks. Load sources, compile the wiki, and the background worker will propose follow-ups.</p>}
        <div className="space-y-3">
          {open.map((t) => (
            <div key={t.id} className="card">
              <div className="flex items-start justify-between gap-3">
                <div className="font-medium">{t.title}</div>
                <div className="flex shrink-0 gap-2">
                  <button className="btn" onClick={() => setStatusOf(t.id, "done")}>Done</button>
                  <button className="btn-ghost" onClick={() => setStatusOf(t.id, "dismissed")}>Dismiss</button>
                </div>
              </div>
              <div className="mt-1 text-sm text-slate-600"><Markdown text={t.why} onCite={setCite} /></div>
              <details className="mt-2">
                <summary className="cursor-pointer text-sm text-indigo-700">Draft</summary>
                <pre className="mt-2 whitespace-pre-wrap rounded bg-slate-50 p-3 text-sm">{t.draft}</pre>
              </details>
              {t.sourceIds.length > 0 && (
                <div className="mt-2 text-xs text-slate-500">
                  Sources: {t.sourceIds.map((i) => (
                    <button key={i} className="mr-1 cursor-pointer rounded bg-indigo-100 px-1 text-indigo-700" onClick={() => setCite(i)}>src:{i}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
      <SourceDrawer id={cite} onClose={() => setCite(null)} />
    </div>
  );
}

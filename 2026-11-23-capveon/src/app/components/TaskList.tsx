"use client";
import { useState } from "react";

interface T { id: string; title: string; owner: string; dueDate: string; done: boolean; source: string; page?: number }

export function TaskList({ initial }: { initial: T[] }) {
  const [tasks, setTasks] = useState(initial);
  async function toggle(t: T) {
    const done = !t.done;
    setTasks(tasks.map((x) => (x.id === t.id ? { ...x, done } : x)));
    const res = await fetch(`/api/tasks/${t.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ done }) });
    if (!res.ok) setTasks(tasks);
  }
  return (
    <div className="card">
      {tasks.map((t) => (
        <label key={t.id} className={`task ${t.done ? "done" : ""}`} style={{ flexDirection: "row", color: "inherit", fontSize: 15 }}>
          <input type="checkbox" checked={t.done} onChange={() => toggle(t)} />
          <span className="t" style={{ flex: 1 }}>{t.title}{t.source === "llm" ? " (suggested)" : ""}{t.page ? ` [p.${t.page}]` : ""}</span>
          <span className="muted">{t.owner}</span>
          <span className="muted">{t.dueDate}</span>
        </label>
      ))}
    </div>
  );
}

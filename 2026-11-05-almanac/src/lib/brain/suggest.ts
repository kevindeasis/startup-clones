import { z } from "zod";
import { SUGGEST_SYSTEM, suggestUser } from "./prompts";
import { callJson, newUsage, type Usage } from "./json";
import { listSources, listTasks, readPage, saveTasks } from "../store";
import { renderSource } from "../text";
import type { Task } from "../types";

const Schema = z.object({
  tasks: z.array(z.object({ title: z.string().min(3), why: z.string(), draft: z.string(), sourceIds: z.array(z.number()).default([]) })).min(1).max(8),
});

/** The "background worker": proposes 3-6 tasks from open-loops.md + recent sources. Returns number added. */
export async function suggest(usage: Usage = newUsage()): Promise<number> {
  const loops = readPage("open-loops.md")?.body ?? "(no open loops yet)";
  const recent = listSources().slice(-5).map((s) => ({ id: s.id, title: s.title, text: renderSource(s).slice(0, 600) }));
  if (!recent.length) return 0;
  const existing = listTasks();
  const out = await callJson(SUGGEST_SYSTEM, suggestUser(loops, recent, existing.map((t) => t.title)), Schema, usage);
  const seen = new Set(existing.filter((t) => t.status !== "dismissed").map((t) => t.title.trim().toLowerCase()));
  const added: Task[] = [];
  for (const t of out.tasks.slice(0, 6)) {
    const key = t.title.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    added.push({
      id: `t_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      title: t.title.trim(),
      why: t.why,
      draft: t.draft,
      sourceIds: t.sourceIds,
      status: "open",
      createdAt: new Date().toISOString(),
    });
  }
  if (added.length) saveTasks([...existing, ...added]);
  return added.length;
}

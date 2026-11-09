import { z } from "zod";
import { EXTRACT_SYSTEM, MERGE_SYSTEM, OVERVIEW_SYSTEM, extractUser, mergeUser, overviewUser } from "./prompts";
import { callJson, callText, newUsage } from "./json";
import { getProvider } from "./llm";
import { suggest } from "./suggest";
import { appendRun, listPages, listSources, readPage, saveSource, writePage } from "../store";
import { citedIds, renderSource, slugify } from "../text";
import type { CompileRun, WikiKind, WikiPage } from "../types";

const str = z.string();
const Extraction = z.object({
  summary: str,
  people: z.array(z.object({ name: str, role: str.nullish(), facts: z.array(str) })).default([]),
  projects: z.array(z.object({ name: str, status: str.nullish(), facts: z.array(str) })).default([]),
  decisions: z.array(z.object({ what: str, when: str.nullish(), who: str.nullish() })).default([]),
  openLoops: z.array(z.object({ what: str, owner: str.nullish(), due: str.nullish() })).default([]),
  events: z.array(z.object({ date: str, what: str })).default([]),
  terms: z.array(z.object({ term: str, meaning: str })).default([]),
});
type Extraction = z.infer<typeof Extraction>;

type Group = { path: string; title: string; kind: WikiKind; section: string; facts: string[]; ids: Set<number> };

const hasCite = (s: string) => /\[src:\d+\]\s*$/.test(s);
const cite = (id: number) => `[src:${id}]`;

/** Re-insert any human-written lines the model dropped. */
export function ensureHumanBlocks(body: string, blocks: string[] | undefined): string {
  if (!blocks?.length) return body;
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const flat = norm(body);
  const missing = blocks.filter((b) => !flat.includes(norm(b)));
  if (!missing.length) return body;
  return `${body.trim()}\n\n## Human notes\n${missing.join("\n")}`;
}

async function mapLimit<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

export async function compile(): Promise<CompileRun> {
  const startedAt = new Date().toISOString();
  const usage = newUsage();
  const all = listSources();
  const fresh = all.filter((s) => !s.compiledAt);
  const base = { id: `run_${Date.now().toString(36)}`, startedAt, provider: getProvider() };
  if (!fresh.length) {
    return { ...base, finishedAt: new Date().toISOString(), sourceIds: [], pagesChanged: [], tasksAdded: 0 };
  }

  // 1. extract
  const extractions = await mapLimit(fresh, 3, async (s) => {
    const ex = await callJson(EXTRACT_SYSTEM, extractUser(s.id, s.title, s.kind, renderSource(s)), Extraction, usage, (v, attempt) => {
      const bad = [v.summary, ...v.people.flatMap((p) => p.facts), ...v.projects.flatMap((p) => p.facts)].filter((f) => !hasCite(f));
      if (bad.length && attempt === 0) throw new Error(`these strings must end with ${cite(s.id)}: ${bad.slice(0, 3).join(" | ")}`);
      const fix = (f: string) => (hasCite(f) ? f : `${f.trim()} ${cite(s.id)}`);
      return { ...v, summary: fix(v.summary), people: v.people.map((p) => ({ ...p, facts: p.facts.map(fix) })), projects: v.projects.map((p) => ({ ...p, facts: p.facts.map(fix) })) };
    });
    s.summary = ex.summary;
    return { s, ex };
  });

  // 2. group by target page
  const groups = new Map<string, Group>();
  const g = (path: string, title: string, kind: WikiKind, section: string, id: number): Group => {
    let x = groups.get(path);
    if (!x) groups.set(path, (x = { path, title, kind, section, facts: [], ids: new Set() }));
    x.ids.add(id);
    return x;
  };
  const events: { date: string; what: string; id: number }[] = [];
  for (const { s, ex } of extractions as { s: (typeof fresh)[number]; ex: Extraction }[]) {
    for (const p of ex.people) {
      const grp = g(`people/${slugify(p.name)}.md`, p.name, "person", "Key facts", s.id);
      if (p.role) grp.facts.push(`Role: ${p.role} ${cite(s.id)}`);
      grp.facts.push(...p.facts);
    }
    for (const p of ex.projects) {
      const title = /^project\b/i.test(p.name) ? p.name : `Project ${p.name}`;
      const grp = g(`projects/${slugify(p.name.replace(/^project\s+/i, ""))}.md`, title, "project", "Key facts", s.id);
      if (p.status) grp.facts.push(`Status: ${p.status} ${cite(s.id)}`);
      grp.facts.push(...p.facts);
    }
    for (const d of ex.decisions) {
      g("decisions.md", "Decisions", "decisions", "Decisions", s.id).facts.push(`${d.what}${d.when || d.who ? ` (${[d.when, d.who && `owner: ${d.who}`].filter(Boolean).join(", ")})` : ""} ${cite(s.id)}`);
    }
    for (const o of ex.openLoops) {
      const extra = [o.owner && `owner: ${o.owner}`, o.due && `due: ${o.due}`].filter(Boolean).join(", ");
      g("open-loops.md", "Open loops", "open-loops", "Open loops", s.id).facts.push(`${o.what}${extra ? ` — ${extra}` : ""} ${cite(s.id)}`);
    }
    for (const t of ex.terms) g("glossary.md", "Glossary", "glossary", "Terms", s.id).facts.push(`**${t.term}**: ${t.meaning} ${cite(s.id)}`);
    for (const e of ex.events) events.push({ ...e, id: s.id });
  }

  // 3. merge (one call per affected page)
  const changed = new Set<string>();
  const now = new Date().toISOString();
  await mapLimit([...groups.values()], 3, async (grp) => {
    const existing = readPage(grp.path);
    const facts = [...new Set(grp.facts)];
    let body = (
      await callText(
        MERGE_SYSTEM,
        mergeUser({ path: grp.path, title: grp.title, kind: grp.kind, section: grp.section, current: existing?.body ?? "", facts, humanBlocks: existing?.human_blocks ?? [] }),
        usage,
      )
    ).replace(/^```(?:markdown)?\n|\n```$/g, "").trim();
    if (!citedIds(body).length) body += `\n\n## ${grp.section}\n${facts.map((f) => `- ${f}`).join("\n")}`;
    body = ensureHumanBlocks(body, existing?.human_edited ? existing.human_blocks : undefined);
    if (body.trim() === existing?.body.trim()) return;
    writePage({
      path: grp.path, title: existing?.title ?? grp.title, kind: grp.kind, updated: now,
      sources: [...(existing?.sources ?? []), ...grp.ids, ...citedIds(body)],
      human_edited: existing?.human_edited, human_blocks: existing?.human_blocks, body,
    });
    changed.add(grp.path);
  });

  // 4. timeline (deterministic)
  if (events.length) {
    const ex = readPage("timeline.md");
    const lines = (ex?.body ?? "# Timeline\n\n| Date | Event |\n| --- | --- |").split("\n");
    const isRow = (l: string) => /^\| \d{4}-\d{2}-\d{2} \|/.test(l);
    const rows = new Set(lines.filter(isRow));
    for (const e of events) rows.add(`| ${e.date} | ${e.what.replace(/\|/g, "/").trim()} ${cite(e.id)} |`);
    const divider = lines.findIndex((l) => /^\|\s*-+/.test(l));
    const head = lines.slice(0, divider + 1);
    const tail = lines.slice(divider + 1).filter((l) => !isRow(l));
    const body = [...head, ...[...rows].sort(), ...tail].join("\n").trim();
    if (body !== ex?.body.trim()) {
      writePage({ path: "timeline.md", title: "Timeline", kind: "timeline", updated: now, sources: [...(ex?.sources ?? []), ...citedIds(body)], human_edited: ex?.human_edited, human_blocks: ex?.human_blocks, body });
      changed.add("timeline.md");
    }
  }

  // 5. overview last
  for (const s of fresh) saveSource({ ...s, compiledAt: now });
  const everything = listSources();
  const ov = readPage("overview.md");
  const pages = listPages().filter((p) => p.path !== "overview.md");
  let obody = (
    await callText(OVERVIEW_SYSTEM, overviewUser(pages, everything.map((s) => s.summary).filter((x): x is string => !!x), ov?.body ?? "", ov?.human_blocks ?? []), usage)
  ).replace(/^```(?:markdown)?\n|\n```$/g, "").trim();
  obody = ensureHumanBlocks(obody, ov?.human_edited ? ov.human_blocks : undefined);
  if (obody !== ov?.body.trim()) {
    const page: WikiPage = { path: "overview.md", title: "Overview", kind: "overview", updated: now, sources: [...(ov?.sources ?? []), ...citedIds(obody)], human_edited: ov?.human_edited, human_blocks: ov?.human_blocks, body: obody };
    writePage(page);
    changed.add("overview.md");
  }

  // 6. suggest + log
  let tasksAdded = 0;
  try {
    tasksAdded = await suggest(usage);
  } catch (e) {
    console.error("suggest failed:", e);
  }
  const run: CompileRun = {
    ...base, finishedAt: new Date().toISOString(), sourceIds: fresh.map((s) => s.id), pagesChanged: [...changed].sort(), usage, tasksAdded,
  };
  appendRun(run);
  return run;
}

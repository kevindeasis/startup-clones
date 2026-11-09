// Deterministic offline "LLM". It is a real LanguageModelV3 (MockLanguageModelV3 from ai/test),
// so the compile/suggest/chat code paths (generateText / streamText) are exactly the production ones.
import { MockLanguageModelV3 } from "ai/test";
import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";
import { tokenize } from "../text";

const approx = (s: string) => Math.max(1, Math.ceil(s.length / 4));
const usage = (inp: number, out: number) => ({
  inputTokens: { total: inp, noCache: inp, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: out, text: out, reasoning: 0 },
});
const finish = { unified: "stop" as const, raw: "stop" };

function promptParts(opts: LanguageModelV3CallOptions) {
  let system = "";
  let user = "";
  for (const m of opts.prompt) {
    if (m.role === "system") system += m.content;
    if (m.role === "user") user = m.content.map((p) => (p.type === "text" ? p.text : "")).join("");
  }
  return { system, user, all: system + user };
}

const unitsOf = (text: string): string[] =>
  text
    .split("\n")
    .flatMap((l) => l.replace(/\*\*/g, "").replace(/^[\s>#*-]+/, "").trim().split(/(?<=[.!?])\s+(?=[A-Z])/))
    .map((s) => s.trim())
    .filter((s) => s.length > 12);

const NAME = "[A-Z][a-z]+ [A-Z][a-z]+";
const CUE = /^(attendees|from|to|author|owner|subject)\s*:/i;

function mockExtract(user: string): string {
  const m = user.match(/<source id="(\d+)" title=("(?:[^"\\]|\\.)*") kind="(\w+)">\n([\s\S]*)\n<\/source>/);
  if (!m) return JSON.stringify({ summary: "Unreadable source.", people: [], projects: [], decisions: [], openLoops: [], events: [], terms: [] });
  const id = Number(m[1]);
  const title = JSON.parse(m[2]) as string;
  const kind = m[3];
  let text = m[4];
  const cite = ` [src:${id}]`;
  if (kind === "csv") {
    const [head, ...rows] = text.trim().split("\n");
    const cols = head.split(",");
    text = rows.map((r) => r.split(",").map((c, i) => `${cols[i]} ${c}`).join("; ") + ".").join("\n");
  }
  const rawLines = text.split("\n");
  const units = unitsOf(text).map((u) => u.replace(/\s*\(\d{4}-\d{2}-\d{2}T[^)]*\)$/, ""));
  const factUnits = units.filter((u) => !CUE.test(u));

  // people
  const people = new Map<string, string | undefined>();
  const note = (n: string, role?: string) => {
    if (!people.has(n) || (role && !people.get(n))) people.set(n, role?.trim() || people.get(n));
  };
  for (const l of rawLines) {
    if (CUE.test(l.trim()) && !/^subject/i.test(l.trim())) for (const x of l.matchAll(new RegExp(`(${NAME})(?:\\s*\\(([^)]*)\\))?`, "g"))) note(x[1], x[2]);
    const sp = l.match(new RegExp(`^(${NAME}):`));
    if (sp) note(sp[1]);
    for (const x of l.matchAll(new RegExp(`owner:\\s*(${NAME})`, "gi"))) note(x[1]);
  }
  const peopleOut = [...people].map(([name, role]) => {
    const first = name.split(" ")[0];
    const re = new RegExp(`\\b(${name}|${first})\\b`);
    const facts = [...new Set(factUnits.filter((u) => re.test(u)))].slice(0, 6).map((u) => u + cite);
    return { name, role, facts: facts.length ? facts : [`${name} appears in "${title}".${cite}`] };
  });

  // projects (track heading context)
  const projNames = [...new Set([...text.matchAll(/Project ([A-Z][a-z]+)/g)].map((x) => x[1]))];
  const projFacts = new Map<string, string[]>(projNames.map((p) => [p, []]));
  const projStatus = new Map<string, string>();
  let ctx: string | null = null;
  for (const line of rawLines) {
    const t = line.trim();
    if (t.startsWith("#")) ctx = projNames.find((p) => t.includes(`Project ${p}`)) ?? null;
    const u = unitsOf(t)[0];
    if (!u || CUE.test(u) || t.startsWith("#")) continue;
    for (const p of projNames) {
      if (ctx === p || new RegExp(`\\b${p}\\b`).test(u)) {
        const f = projFacts.get(p)!;
        if (!f.includes(u + cite)) f.push(u + cite);
        const st = u.match(/^Status:\s*(.+?)\.?$/i);
        if (st && ctx === p) projStatus.set(p, st[1]);
        else if (/at risk/i.test(u) && !projStatus.has(p)) projStatus.set(p, "at risk");
      }
    }
  }
  const projectsOut = projNames.map((p) => ({ name: p, status: projStatus.get(p), facts: projFacts.get(p)!.slice(0, 7) }));

  // decisions / open loops / events / terms
  const decisions: unknown[] = [];
  const openLoops: unknown[] = [];
  const events: { date: string; what: string }[] = [];
  const terms: { term: string; meaning: string }[] = [];
  for (const raw of rawLines) {
    const line = raw.replace(/^[\s>*-]+/, "").replace(/\s*\(\d{4}-\d{2}-\d{2}T[^)]*\)$/, "").trim();
    const speaker = line.match(new RegExp(`^(${NAME}):`))?.[1];
    const owner = line.match(new RegExp(`owner:\\s*(${NAME})`))?.[1];
    const due = line.match(/due:\s*(\d{4}-\d{2}-\d{2})/)?.[1];
    const strip = (s: string) => s.replace(/\s*\((?:owner|due)[^)]*\)\s*\.?$/, "").trim();
    let x: RegExpMatchArray | null;
    if ((x = line.match(/\bDecision\s*:\s*(.+)$/i))) decisions.push({ what: strip(x[1]), who: owner ?? speaker });
    else if ((x = line.match(/\b(?:Action item|TODO|Open question)\s*:\s*(.+)$/i))) openLoops.push({ what: strip(x[1]), owner: owner ?? speaker, due });
    else if (/\bwaiting on\b/i.test(line)) openLoops.push({ what: line.replace(/^[^:]*:\s*/, ""), owner: speaker });
    const t = line.match(/^Term\s*:\s*(.+?)\s*[=—]\s*(.+)$/);
    if (t) terms.push({ term: t[1], meaning: t[2] });
    const d = line.match(/(\d{4}-\d{2}-\d{2})/);
    if (d && !/due:|^(Decision|Action item|Open question|TODO|Term)/i.test(line) && !CUE.test(line)) {
      const what = (raw.trim().startsWith("#") ? line.replace(d[1], "") : line).replace(/^#+\s*/, "").replace(/\s*[-:]\s*$/, "").replace(/^\s*[-:]\s*/, "").trim();
      if (what.length > 8 && events.length < 5) events.push({ date: d[1], what });
    }
  }
  const first = kind === "csv" ? `Table with ${text.trim().split("\n").length} rows` : (unitsOf(rawLines.filter((l) => !l.trim().startsWith("#")).join("\n")).find((u) => !CUE.test(u)) ?? title);
  const summary = `${title}: ${first.slice(0, 180).replace(/\s+$/, "")}${cite}`;
  return JSON.stringify({ summary, people: peopleOut, projects: projectsOut, decisions, openLoops, events, terms });
}

function mockMerge(user: string): string {
  const title = JSON.parse(user.match(/title=("(?:[^"\\]|\\.)*")>/)?.[1] ?? '"Page"') as string;
  const section = user.match(/<section>(.*?)<\/section>/)?.[1] ?? "Key facts";
  const current = (user.match(/<current_page>\n([\s\S]*?)\n<\/current_page>/)?.[1] ?? "").trim();
  const facts = (user.match(/<new_facts>\n([\s\S]*?)\n<\/new_facts>/)?.[1] ?? "").split("\n").filter((l) => l.startsWith("- "));
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const have = new Set(current.split("\n").map(norm));
  const add = facts.filter((f) => !have.has(norm(f)));
  if (!current) return `# ${title}\n\n## ${section}\n${add.join("\n")}`;
  if (!add.length) return current;
  const lines = current.split("\n");
  const h = lines.findIndex((l) => l.trim() === `## ${section}`);
  if (h < 0) return `${current}\n\n## ${section}\n${add.join("\n")}`;
  let end = lines.findIndex((l, i) => i > h && l.startsWith("## "));
  if (end < 0) end = lines.length;
  while (end > h + 1 && lines[end - 1].trim() === "") end--;
  lines.splice(end, 0, ...add);
  return lines.join("\n");
}

function mockOverview(user: string): string {
  const pages = [...user.matchAll(/^- (.+) \(([^)]+\.md)\)$/gm)].map((m) => ({ title: m[1], path: m[2] }));
  const sums = (user.match(/<summaries>\n([\s\S]*?)\n<\/summaries>/)?.[1] ?? "").split("\n").map((l) => l.replace(/^- /, "")).filter(Boolean);
  const counts = new Map<string, number>();
  for (const x of sums.join(" ").matchAll(/\b([A-Z][a-z]+ (?:Robotics|Labs|Inc|Corp|Systems))\b/g)) counts.set(x[1], (counts.get(x[1]) ?? 0) + 1);
  const company = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "The Company";
  const list = (pre: string) => pages.filter((p) => p.path.startsWith(pre)).map((p) => `- ${p.title}`).join("\n") || "- (none yet)";
  return `# ${company}\n\n${sums[0] ?? "No sources compiled yet."}\n\n## Current focus\n${sums.slice(1, 8).map((s) => `- ${s}`).join("\n")}\n\n## People\n${list("people/")}\n\n## Projects\n${list("projects/")}`;
}

function mockSuggest(user: string): string {
  const loops = (user.match(/<open_loops>\n([\s\S]*?)\n<\/open_loops>/)?.[1] ?? "").split("\n").filter((l) => l.startsWith("- ") && /\[src:\d+\]/.test(l));
  const recent = [...user.matchAll(/<source id="(\d+)" title=("(?:[^"\\]|\\.)*")>/g)].map((m) => ({ id: Number(m[1]), title: JSON.parse(m[2]) as string }));
  const tasks: { title: string; why: string; draft: string; sourceIds: number[] }[] = [];
  for (const l of loops.slice(0, 4)) {
    const ids = [...l.matchAll(/\[src:(\d+)\]/g)].map((m) => Number(m[1]));
    const body = l.replace(/^- /, "").replace(/\s*\[src:\d+\]/g, "");
    const what = body.split(/\s+—\s+/)[0].replace(/\.$/, "");
    const owner = body.match(/owner:\s*([^,]+)/)?.[1];
    tasks.push({
      title: `Follow up: ${what.slice(0, 80)}`,
      why: `Open loop in the wiki: ${body}`,
      draft: `Subject: Quick follow-up - ${what.slice(0, 60)}\n\nHi ${owner ?? "team"},\n\nChecking in on: ${what}.\nCould you share a short status update today, and flag anything blocking you?\n\nThanks!`,
      sourceIds: ids,
    });
  }
  for (const s of recent.slice(-3).reverse()) {
    if (tasks.length >= 3) break;
    tasks.push({
      title: `Review and share notes from "${s.title}"`,
      why: "Recently ingested source with no explicit follow-up yet.",
      draft: `Checklist:\n- [ ] Skim "${s.title}" [src:${s.id}]\n- [ ] Send a 3-bullet recap to the team\n- [ ] Add any missing owners/dates to the wiki`,
      sourceIds: [s.id],
    });
  }
  return JSON.stringify({ tasks: tasks.slice(0, 6) });
}

function mockChatAnswer(system: string, question: string): string {
  const blocks = [...system.matchAll(/<wiki_page path="([^"]+)"[^>]*>\n([\s\S]*?)\n<\/wiki_page>/g)];
  const cited: { path: string; line: string }[] = [];
  for (const b of blocks) for (const l of b[2].split("\n")) if (/\[src:\d+\]/.test(l) && !l.startsWith("#")) cited.push({ path: b[1], line: l.replace(/^[-*\s]+/, "").trim() });
  const q = new Set(tokenize(question));
  const scored = cited.map((c) => ({ ...c, s: tokenize(c.line).filter((t) => q.has(t)).length })).sort((a, b) => b.s - a.s);
  let picks: { path: string; line: string }[] = scored.filter((c) => c.s > 0).slice(0, 3);
  if (!picks.length && /company|working|doing|overview|summary|about|focus|going|status/i.test(question)) {
    picks = cited.filter((c) => c.path === "overview.md").slice(0, 3);
  }
  if (!picks.length) return "The wiki doesn't cover this yet. Try ingesting more sources and recompiling.";
  return `Here is what the wiki says:\n\n${picks.map((p) => `- ${p.line}`).join("\n")}\n\n(Offline mock answer: lines picked from ${[...new Set(picks.map((p) => p.path))].join(", ")}.)`;
}

export function createMockModel() {
  return new MockLanguageModelV3({
    provider: "mock",
    modelId: "mock-company-brain",
    doGenerate: async (opts) => {
      const { system, user, all } = promptParts(opts);
      let text: string;
      if (system.includes("[[STEP:extract]]")) text = mockExtract(user);
      else if (system.includes("[[STEP:merge]]")) text = mockMerge(user);
      else if (system.includes("[[STEP:overview]]")) text = mockOverview(user);
      else if (system.includes("[[STEP:suggest]]")) text = mockSuggest(user);
      else text = mockChatAnswer(system, user);
      return { content: [{ type: "text", text }], finishReason: finish, usage: usage(approx(all), approx(text)), warnings: [] };
    },
    doStream: async (opts) => {
      const { system, user, all } = promptParts(opts);
      const text = mockChatAnswer(system, user);
      const parts = text.match(/\S+\s*/g) ?? [text];
      const stream = new ReadableStream({
        async start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({ type: "text-start", id: "t1" });
          for (const p of parts) {
            await new Promise((r) => setTimeout(r, 20));
            controller.enqueue({ type: "text-delta", id: "t1", delta: p });
          }
          controller.enqueue({ type: "text-end", id: "t1" });
          controller.enqueue({ type: "finish", finishReason: finish, usage: usage(approx(all), approx(text)) });
          controller.close();
        },
      });
      return { stream };
    },
  });
}

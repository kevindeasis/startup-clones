import { heuristicCoverage } from "./coverage";
import type { ChatMessage, InterviewExtraction, Participant, Severity, StudySynthesis } from "./schemas";

const VERBS =
  /\b(create|creat\w+|send|sent|check\w*|enter\w*|copy|copied|prepare\w*|review\w*|approv\w+|updat\w+|receiv\w+|ask\w*|forward\w*|open\w*|writ\w+|export\w*|import\w*|call\w*|fill\w*|log\w*|look\w*|calculat\w+|compar\w+|upload\w*|request\w*|collect\w*|build|built|pick\w*|start\w*)\b/i;
const TOOLS = ["Excel", "SAP", "CRM", "Salesforce", "Outlook", "Email", "Slack", "Teams", "SharePoint", "Word", "PDF", "ERP"];
const MANUAL = /\b(manual\w*|by hand|copy|copied|paste|retype|re-?enter|type it)\b/i;
const PAIN = /\b(manual\w*|copy|copied|wait\w*|slow|twice|excel|email|delay\w*|forever|annoying|frustrat\w+)\b/i;
const EXCEPTION = /\b(if (the|a|there|it|they|no)|unless|except\w*|goes wrong|rejected|otherwise)\b/i;
const HANDOFF = /\b(send|sent|forward\w*|hand\w*|pass\w*|ask\w*)\b[^.]*\b(to|team|manager|finance|legal|sales ops|colleague)\b/i;
const CHANNEL: [RegExp, string][] = [[/email|outlook/i, "email"], [/slack|teams/i, "chat"], [/sap|erp|crm|salesforce/i, "erp"]];

const sentences = (text: string) => text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

function userMessages(messages: ChatMessage[]): string[] {
  return messages.filter((m) => m.role === "user").map((m) => m.content);
}

/** Deterministic heuristic extraction used in mock mode. */
export function mockExtract(messages: ChatMessage[], participant: Pick<Participant, "role">): InterviewExtraction {
  const users = userMessages(messages);
  const role = participant.role || "Team member";

  const steps: InterviewExtraction["steps"] = [];
  const handoffs: InterviewExtraction["handoffs"] = [];
  const exceptions: InterviewExtraction["exceptions"] = [];
  const painPoints: InterviewExtraction["painPoints"] = [];
  const stepOf = new Map<number, string>();

  users.forEach((msg, i) => {
    const verbSentence = sentences(msg).find((s) => VERBS.test(s));
    if (verbSentence) {
      const id = `s${steps.length + 1}`;
      stepOf.set(i, id);
      steps.push({
        id,
        name: clip(verbSentence.replace(/^(then|first|next|after that|finally),?\s*/i, "").replace(/[.!?]+$/, ""), 50),
        actorRole: role,
        tools: TOOLS.filter((t) => new RegExp(`\\b${t}\\b`, "i").test(msg)),
        manual: MANUAL.test(msg),
      });
    }
    const exc = sentences(msg).find((s) => EXCEPTION.test(s));
    if (exc) {
      exceptions.push({ condition: clip(exc, 100), whatHappens: clip(exc, 160) });
    }
    const pain = sentences(msg).find((s) => PAIN.test(s) && /\b(slow|wait\w*|twice|manual\w*|forever|delay\w*|annoying|frustrat\w+|copy|copied)\b/i.test(s));
    if (pain) {
      const severity: Severity = /\b(forever|twice|always|every)\b/i.test(pain) ? "high" : "medium";
      const sid = stepOf.get(i);
      painPoints.push({ description: clip(pain, 120), severity, quote: pain, relatedStepIds: sid ? [sid] : [] });
    }
  });

  steps.forEach((step, i) => {
    const next = steps[i + 1];
    const msg = users.find((u) => u.includes(step.name.slice(0, 20))) ?? "";
    if (next && HANDOFF.test(msg)) {
      const channel = CHANNEL.find(([re]) => re.test(msg))?.[1] ?? "verbal";
      handoffs.push({ fromStep: step.id, toStep: next.id, toRole: next.actorRole, channel });
    }
  });

  const automationCandidates = steps
    .filter((s) => s.manual)
    .map((s) => ({ stepIds: [s.id], idea: `Automate: ${s.name}`, confidence: "medium" as const }));

  const covered = new Set(users.flatMap((u) => heuristicCoverage(u)));
  return {
    summary: `Captured ${steps.length} steps, ${painPoints.length} pain points and ${exceptions.length} exceptions from ${users.length} answers.`,
    trigger: users[0] ? clip(sentences(users[0])[0] ?? users[0], 160) : "",
    steps,
    handoffs,
    exceptions,
    painPoints,
    automationCandidates,
    coverage: [...covered],
  };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3);
function similar(a: string, b: string, threshold = 0.4): boolean {
  const x = new Set(norm(a));
  const y = new Set(norm(b));
  if (!x.size || !y.size) return false;
  const inter = [...x].filter((w) => y.has(w)).length;
  return inter / (x.size + y.size - inter) >= threshold;
}

type Item = { participant: Pick<Participant, "team" | "site" | "role">; extraction: InterviewExtraction };

/** Deterministic heuristic synthesis used in mock mode. */
export function mockSynthesise(items: Item[]): StudySynthesis {
  const merged: StudySynthesis["mergedSteps"] = [];
  const edgeSet = new Map<string, StudySynthesis["edges"][number]>();

  for (const { extraction } of items) {
    const idMap = new Map<string, string>();
    for (const step of extraction.steps) {
      let target = merged.find((m) => similar(m.name, step.name, 0.3));
      if (!target) {
        target = { id: `m${merged.length + 1}`, name: step.name, actorRole: step.actorRole, tools: [], manual: false, mentionedBy: 0, variants: [] };
        merged.push(target);
      } else if (target.name !== step.name) {
        target.variants?.push(step.name);
      }
      target.mentionedBy += 1;
      target.manual ||= step.manual;
      target.tools = [...new Set([...target.tools, ...step.tools])];
      idMap.set(step.id, target.id);
    }
    const ordered = extraction.steps.map((s) => idMap.get(s.id)!);
    ordered.slice(1).forEach((to, i) => {
      const from = ordered[i];
      if (from !== to) edgeSet.set(`${from}>${to}`, { from, to });
    });
  }
  merged.forEach((m) => { if (!m.variants?.length) delete m.variants; });

  const exceptions: StudySynthesis["exceptions"] = [];
  for (const { extraction } of items) {
    for (const e of extraction.exceptions) {
      const hit = exceptions.find((x) => similar(x.condition, e.condition));
      if (hit) hit.mentionedBy += 1;
      else exceptions.push({ ...e, mentionedBy: 1 });
    }
  }

  const painPoints: StudySynthesis["painPoints"] = [];
  for (const { participant, extraction } of items) {
    for (const p of extraction.painPoints) {
      let hit = painPoints.find((x) => similar(x.description, p.description));
      if (!hit) {
        hit = { description: p.description, severity: p.severity, count: 0, teams: [], sites: [], quote: p.quote };
        painPoints.push(hit);
      }
      hit.count += 1;
      if (p.severity === "high") hit.severity = "high";
      if (participant.team && !hit.teams.includes(participant.team)) hit.teams.push(participant.team);
      if (participant.site && !hit.sites.includes(participant.site)) hit.sites.push(participant.site);
    }
  }

  const recommendations: StudySynthesis["recommendations"] = [];
  for (const s of merged.filter((m) => m.manual)) {
    recommendations.push({ type: "automate", title: `Automate: ${clip(s.name, 60)}`, rationale: `Done manually; mentioned by ${s.mentionedBy} of ${items.length} participants.`, stepIds: [s.id] });
  }
  for (const s of merged.filter((m) => m.tools.length >= 2)) {
    recommendations.push({ type: "standardise", title: `Standardise tooling for: ${clip(s.name, 50)}`, rationale: `Uses several tools (${s.tools.join(", ")}).`, stepIds: [s.id] });
  }
  for (const p of painPoints.filter((x) => /twice|duplicate|again/i.test(x.description))) {
    const ids = merged.filter((m) => similar(m.name, p.description)).map((m) => m.id);
    recommendations.push({ type: "eliminate", title: "Remove duplicated work", rationale: p.description, stepIds: ids });
  }
  for (const s of merged.filter((m) => (m.variants?.length ?? 0) > 0)) {
    recommendations.push({ type: "clarify_owner", title: `Clarify how this step is done: ${clip(s.name, 50)}`, rationale: `Described ${(s.variants?.length ?? 0) + 1} different ways.`, stepIds: [s.id] });
  }

  return {
    headline: `${merged.length} process steps merged from ${items.length} interviews; ${painPoints.length} distinct pain points.`,
    mergedSteps: merged,
    edges: [...edgeSet.values()],
    exceptions,
    painPoints,
    recommendations,
    openQuestions: items.length < 3 ? ["Interview more participants to confirm the shared process."] : ["Which variants of each step are the intended standard?"],
  };
}

import type { Account, Action, Direction, SignalType, SuggestedPlay } from "./types";
import type { AccountCtx, Source } from "./context";
import type { KickoffPlan, SignalClass } from "./schemas";
import { daysBetween, money, toDate, today, words } from "./util";

// ---------------------------------------------------------------- kickoff
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const TASK_RE = /\b(TODO|action item|will|need to|needs to|blocker|blocked|SSO|SCIM)\b/i;
const GOAL_RE = /\b(goal|success looks like|go live|go-live|launch|by the end of|we want to|target)\b/i;
const BLOCKER_RE = /\b(blocker|blocked|unresolved|waiting on|no owner|nobody (?:on \w+ \w+ )?owns)\b/i;
const RISK_RE = /\b(risk|concern|worried|delay|slip|tight|dependency)\b/i;
const SPEAKER_RE = /^([A-Z][\w.'-]*(?:\s[A-Z][\w.'-]*)*)\s*\(([^)]+)\):\s*(.*)$/;

interface Utterance { name: string; org: string; role: string; text: string }

function parseUtterances(transcript: string): Utterance[] {
  const out: Utterance[] = [];
  for (const raw of transcript.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = SPEAKER_RE.exec(line);
    if (m) {
      const [org, ...rest] = m[2].split(",").map((s) => s.trim());
      out.push({ name: m[1], org, role: rest.join(", ") || "participant", text: m[3] });
    } else if (out.length) out[out.length - 1].text += ` ${line}`;
  }
  return out;
}

function dueIn(sentence: string, at: string, fallback: number): number {
  const s = sentence.toLowerCase();
  const iso = /\bby (\d{4}-\d{2}-\d{2})/.exec(s);
  if (iso) return Math.max(1, daysBetween(at, iso[1]));
  const md = new RegExp(`\\bby (${MONTHS.join("|")})[a-z]*\\.? (\\d{1,2})\\b`).exec(s);
  if (md) {
    const y = toDate(at).getUTCFullYear();
    let d = `${y}-${String(MONTHS.indexOf(md[1]) + 1).padStart(2, "0")}-${md[2].padStart(2, "0")}`;
    if (d < at) d = d.replace(String(y), String(y + 1));
    return Math.max(1, daysBetween(at, d));
  }
  const wd = new RegExp(`\\b(?:by|on|before) (?:end of )?(?:next )?(${WEEKDAYS.join("|")})`).exec(s);
  if (wd) {
    const diff = (WEEKDAYS.indexOf(wd[1]) - toDate(at).getUTCDay() + 7) % 7;
    return diff === 0 ? 7 : diff;
  }
  if (/\btomorrow\b/.test(s)) return 1;
  if (/\bnext week\b/.test(s)) return 7;
  if (/\bend of (the )?week\b/.test(s)) return 5;
  return fallback;
}

function clean(sentence: string): string {
  let t = sentence.replace(/^(understood|noted|great|thanks[^.,]*|sure|okay|ok)[,.]?\s+/i, "").replace(/,\s+so we will .*$/i, "")
    .replace(/^(TODO|action item)\s*[:\-–]?\s*/i, "").replace(/\s+/g, " ").trim().replace(/[.!]+$/, "");
  t = t.charAt(0).toUpperCase() + t.slice(1);
  return t.length > 120 ? `${t.slice(0, 117)}…` : t;
}

export function mockPlanKickoff(transcript: string, account: Pick<Account, "name" | "aliases">, at: string): KickoffPlan {
  const utts = parseUtterances(transcript);
  const names = [account.name, ...account.aliases].map((s) => s.toLowerCase());
  const sideOf = (org: string): "vendor" | "customer" =>
    names.some((n) => org.toLowerCase().includes(n) || n.includes(org.toLowerCase())) ? "customer" : "vendor";

  const stakeholders = new Map<string, { name: string; role: string; side: "vendor" | "customer" }>();
  for (const u of utts) if (!stakeholders.has(u.name)) stakeholders.set(u.name, { name: u.name, role: u.role, side: sideOf(u.org) });
  const byFirst = new Map([...stakeholders.values()].map((s) => [s.name.split(" ")[0], s]));

  const goals: string[] = [];
  const risks: string[] = [];
  const tasks: KickoffPlan["tasks"] = [];
  const seen = new Set<string>();

  for (const u of utts) {
    const speaker = stakeholders.get(u.name)!;
    for (const sentence of u.text.split(/(?<=[.!?])\s+/)) {
      const s = sentence.trim();
      if (s.split(/\s+/).length < 4) continue;
      const explicitTask = /\b(TODO|action item)\b/i.test(s);
      if (GOAL_RE.test(s) && !explicitTask) { goals.push(clean(s)); continue; }
      if (RISK_RE.test(s) && !TASK_RE.test(s)) { risks.push(clean(s)); continue; }
      if (!TASK_RE.test(s) || s.endsWith("?")) continue;
      const isBlocker = BLOCKER_RE.test(s) || (/\b(SSO|SCIM)\b/.test(s) && !/\bwill\b/i.test(s));
      // one blocker task per topic (SSO/SCIM statements repeat across speakers)
      const topic = isBlocker ? (/\b(SSO|SCIM)\b/.test(s) ? "sso-scim" : clean(s).toLowerCase().split(" ").slice(0, 4).join(" ")) : clean(s).toLowerCase();
      if (seen.has(topic) || s.replace(/\W/g, "").length < 12) continue;
      seen.add(topic);
      const title = isBlocker && !/\bwill\b/i.test(s) ? `Resolve blocker: ${clean(s)}` : clean(s);
      const named = /\b([A-Z][a-z]+)\s+(?:will|to|needs to|need to)\b/.exec(s);
      const owner = named && byFirst.has(named[1]) ? byFirst.get(named[1])! : /\bI(?:'ll| will)\b/.test(s) ? speaker : undefined;
      tasks.push({
        title,
        ownerSide: (owner ?? speaker).side,
        ownerName: owner?.name,
        dueInDays: dueIn(s, at, isBlocker ? 3 : 7),
        isBlocker,
      });
    }
  }
  if (!goals.length) goals.push(`Complete onboarding for ${account.name}`);
  const capped = tasks.slice(0, 12);
  const blockers = capped.filter((t) => t.isBlocker).map((t) => ({ description: t.title, taskTitle: t.title }));
  const recap = buildRecap(account.name, goals, capped, blockers);
  return { goals: goals.slice(0, 5), tasks: capped, blockers, stakeholders: [...stakeholders.values()], risks: risks.slice(0, 4), recap };
}

function buildRecap(name: string, goals: string[], tasks: KickoffPlan["tasks"], blockers: KickoffPlan["blockers"]): string {
  const v = tasks.filter((t) => t.ownerSide === "vendor").length;
  const parts = [
    `Kickoff recap — ${name}: ${tasks.length} tasks agreed (${v} vendor, ${tasks.length - v} customer), ${blockers.length} blocker${blockers.length === 1 ? "" : "s"}.`,
    `Goals: ${goals.slice(0, 3).map((g, i) => `${i + 1}) ${g}`).join("; ")}.`,
  ];
  if (blockers.length) parts.push(`Blockers: ${blockers.map((b) => b.description).join("; ")}.`);
  const first = tasks.find((t) => !t.isBlocker);
  if (first) parts.push(`First up: ${first.title} (due in ${first.dueInDays}d).`);
  return words(parts.join(" "), 150);
}

// ---------------------------------------------------------------- radar
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function tagAccounts(text: string, accounts: Pick<Account, "id" | "name" | "aliases" | "domain">[]): string[] {
  return accounts
    .filter((a) => [a.name, ...a.aliases, a.domain].filter(Boolean).some((t) => new RegExp(`(^|[^\\w])${esc(t)}($|[^\\w])`, "i").test(text)))
    .map((a) => a.id);
}

const RULES: { re: RegExp; type: SignalType; dir: Direction; play: SuggestedPlay; line: string }[] = [
  { re: /\blay\s?offs?\b|\bcuts? (?:\d+|jobs|staff|workforce)|\bjob cuts\b/i, type: "layoffs", dir: "risk", play: "exec_check_in", line: "Layoffs can shrink seat counts and budget, so check in with an executive sponsor." },
  { re: /\boutage\b|\bdowntime\b/i, type: "outage", dir: "risk", play: "exec_check_in", line: "An outage may erode confidence, so reach out proactively." },
  { re: /\bacquir(?:e|es|ed|ing|ition)\b/i, type: "acquisition", dir: "expansion", play: "expansion_project", line: "An acquisition usually brings new teams and workloads, which is an expansion opening." },
  { re: /\braises?\b|\bSeries [A-F]\b|\bfunding\b/i, type: "funding", dir: "expansion", play: "expansion_project", line: "Fresh funding signals budget and growth, so explore an expansion." },
  { re: /\bCTO\b|\bCEO\b|\bappoint(?:s|ed)?\b/i, type: "leadership_change", dir: "neutral", play: "champion_note", line: "A leadership change is a good reason to refresh the executive relationship." },
  { re: /\bhiring\b|\bopen roles\b|\bopens? \d+ (?:engineering )?roles\b|\b\d+ (?:engineering |open )?roles\b/i, type: "hiring", dir: "expansion", play: "champion_note", line: "Heavy hiring points to growing teams and more seats." },
];

export function mockClassifySignal(item: { title: string; text: string }, accounts: Pick<Account, "id" | "name" | "aliases" | "domain">[]): SignalClass {
  const body = `${item.title}. ${item.text}`;
  const accountIds = tagAccounts(body, accounts);
  const rule = RULES.find((r) => r.re.test(body));
  if (!accountIds.length) {
    return { relevant: false, accountIds: [], signalType: rule?.type ?? "other", direction: "neutral", summary: "No tracked account is mentioned.", suggestedPlay: "none" };
  }
  const names = accounts.filter((a) => accountIds.includes(a.id)).map((a) => a.name).join(", ");
  if (!rule) {
    return { relevant: true, accountIds, signalType: "other", direction: "neutral", summary: `${item.title}. Mentions ${names}; no clear expansion or risk signal.`, suggestedPlay: "none" };
  }
  return { relevant: true, accountIds, signalType: rule.type, direction: rule.dir, summary: `${item.title}. ${rule.line}`, suggestedPlay: rule.play };
}

// ---------------------------------------------------------------- actions
const PLAY_STEPS: Record<string, string[]> = {
  adoption_workshop: ["Book a 60-minute adoption workshop with the champion and team leads", "Share a list of inactive seats and the features top users rely on", "Re-measure weekly active users two weeks after the workshop"],
  check_in: ["Hold a check-in call with the champion this week", "Review the recent tickets with support and agree on fixes and dates", "Confirm in writing what a recovered usage level looks like"],
  win_back: ["Escalate to an executive sponsor with a personal outreach", "Offer a hands-on implementation session to rebuild the core workflow", "Set a usage recovery milestone and review it weekly for a month"],
  renewal_prep: ["Draft the renewal brief and review it with the account owner", "Book the renewal conversation with the champion", "Prepare the renewal proposal with the recommended ask"],
  unblock: ["Name a single owner on each side for the blocked item", "Escalate to the customer sponsor and agree a new date", "Re-baseline the go-live plan once the blocker is cleared"],
  collections: ["Contact the customer's finance contact with the invoice and payment link", "Confirm a payment date in writing", "Pause new work orders if the invoice stays unpaid past 30 days"],
  expansion_project: ["Open an expansion project and scope the new use case", "Ask the champion who will own the new workload", "Draft an order form for the added capacity"],
  champion_note: ["Send the champion a short congratulatory note referencing the news", "Ask what changes for their team in the next quarter", "Offer a planning call to size any additional usage"],
  exec_check_in: ["Schedule an executive check-in within the week", "Ask how the news affects budget, seats and priorities", "Update the account plan and the renewal forecast"],
};
export const playSteps = (play: string) => PLAY_STEPS[play] ?? PLAY_STEPS.check_in;

export function mockExplainAction(a: Pick<Action, "type" | "play" | "evidence" | "title">, ctx: { account: Account }) {
  const e = a.evidence;
  const name = ctx.account.name;
  let rationale: string;
  switch (a.type) {
    case "usage_drop":
      rationale = `${name}'s metered usage fell ${e.dropPct}% (${e.recentAvg} vs ${e.priorAvg} units per week), and active seats moved from ${e.breadthPriorPct}% to ${e.breadthRecentPct}% of licensed seats with weekly tickets going from ${e.ticketsPrior} to ${e.ticketsRecent}. ` +
        `The recommended play is ${String(a.play).replace(/_/g, " ")} because ${a.play === "adoption_workshop" ? "seat adoption fell with usage" : a.play === "check_in" ? "support load rose while usage fell" : "usage collapsed without a clear support cause"}.`;
      break;
    case "renewal_prep":
      rationale = `${name} renews on ${e.renewalDate}, ${e.daysToRenewal} days from now, and no renewal brief exists yet. Health is ${e.health}, so preparing the brief now leaves time to address risks before the ask.`;
      break;
    case "onboarding_stalled":
      rationale = `The blocker "${e.task}" is ${e.daysOverdue} days overdue and still open in the onboarding project. Until it is resolved the customer cannot reach go-live.`;
      break;
    case "billing_risk":
      rationale = `Invoice ${e.invoiceId} for ${money(Number(e.amount))} is ${e.daysOverdue} days past due. Overdue invoices correlate with churn risk and should be raised with the customer's finance contact.`;
      break;
    case "expansion":
      rationale = e.signalTitle
        ? `A Radar signal ("${e.signalTitle}") suggests ${name} is growing. This is a good moment to open an expansion conversation.`
        : `${name} used at least 90% of its weekly quota in ${e.weeksNearQuota} of the last 4 weeks (latest ${e.quotaPct}% of quota). They are likely to need more capacity soon.`;
      break;
    default:
      rationale = `A Radar signal ("${e.signalTitle}") suggests risk at ${name}. Reach out before it shows up in usage or renewal conversations.`;
  }
  return { rationale, nextSteps: playSteps(a.play) };
}

// ---------------------------------------------------------------- brief & ask
export function mockBrief(ctx: AccountCtx, ask: { proposedArr: number; termMonths: number; justification: string }): string {
  const a = ctx.account;
  const h = a.health;
  const s = ctx.stats;
  const trend = ctx.snapshots.map((x) => x.score);
  const open = ctx.actions.filter((x) => x.status === "open");
  const expansions = [...open.filter((x) => x.type === "expansion").map((x) => x.title), ...ctx.signals.filter((x) => x.direction === "expansion").map((x) => x.summary)];
  const tasks = ctx.projects.flatMap((p) => p.tasks);
  const done = tasks.filter((t) => t.done).length;
  const overdueInv = ctx.invoices.filter((i) => !i.paidAt && i.dueAt < today());
  return [
    `# Renewal brief — ${a.name}`,
    `Renewal ${a.renewalDate} (${ctx.daysToRenewal} days) · ARR ${money(a.arr)} · plan ${a.plan} · owner ${a.owner} · champion ${a.champion.name}`,
    "",
    "## Health trend",
    `Current health is ${h?.score ?? "n/a"} (${h?.band ?? "n/a"}). ${h?.why ?? ""} ${trend.length > 1 ? `Across ${trend.length} analysis runs the score moved ${trend[0]} → ${trend.at(-1)}.` : ""}`,
    "",
    "## Usage story",
    `Over the last 2 complete weeks metered usage averaged ${Math.round(s.recentAvg)} units versus ${Math.round(s.priorAvg)} in the prior 4 weeks (${s.dropPct >= 0 ? "-" : "+"}${Math.abs(Math.round(s.dropPct))}%). The latest week is ${ctx.quotaPct}% of the ${a.quotaUnitsPerWeek} unit weekly quota, with ${Math.round(s.breadthRecent * 100)}% of ${a.seats} seats active.`,
    "",
    "## Open risks",
    open.filter((x) => x.type !== "expansion").map((x) => `- ${x.title}: ${x.rationale}`).join("\n") || "- No open risk actions.",
    overdueInv.length ? `- ${overdueInv.length} overdue invoice(s) outstanding.` : "",
    `- ${ctx.tickets.filter((t) => !t.closedAt).length} open support ticket(s).`,
    "",
    "## Expansion paths",
    expansions.map((x) => `- ${x}`).join("\n") || "- No expansion signals detected yet.",
    "",
    "## Renewal ask",
    `Propose **${money(ask.proposedArr)}** ARR on a **${ask.termMonths}-month** term. ${ask.justification}`,
    "",
    "## Talking points",
    `- Success so far: ${tasks.length ? `${done} of ${tasks.length} project tasks complete` : "no active projects yet"}.`,
    `- Usage: ${ctx.quotaPct}% of quota, ${Math.round(s.breadthRecent * 100)}% of seats active.`,
    `- Ask ${a.champion.name} about priorities for the next term and who signs.`,
  ].filter((l) => l !== "").join("\n").replace(/\n(##|# )/g, "\n\n$1");
}

export function mockAnswer(question: string, sources: Source[]): string {
  if (!sources.length) return "I could not find anything about that in this account's data.";
  const top = sources.slice(0, 3);
  return `Based on the most relevant records for "${question}": ` + top.map((s) => `${s.title} — ${s.text.replace(/\s+/g, " ").slice(0, 160)} [${s.n}]`).join(" ");
}

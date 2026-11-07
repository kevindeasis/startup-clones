// All LLM calls live here. Real path: Vercel AI SDK + Anthropic. Mock path: deterministic fakes.
import { generateObject, generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import * as P from "./prompts";
import {
  buyerModelSchema, guideSchema, personasSchema, simulationSchema,
  type BuyerModel, type Persona, type Reaction,
} from "./schemas";

export const DONE = "[DONE]";

export function isMock() {
  return process.env.MOCK_LLM === "1" || !process.env.ANTHROPIC_API_KEY;
}

let warned = false;
function mock() {
  const m = isMock();
  if (m && !warned) {
    warned = true;
    console.warn("[gatherlite] MOCK LLM mode active (MOCK_LLM=1 or no ANTHROPIC_API_KEY): returning deterministic fake outputs.");
  }
  return m;
}
const model = () => anthropic(process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5");

export type Turn = { role: "assistant" | "user"; content: string };
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

// ---------- Guide ----------
export async function generateGuide(goal: string, audience: string, seeds: string[]): Promise<string[]> {
  let qs: string[];
  if (mock()) {
    qs = [
      `Tell me a bit about your role and what a typical week looks like for you.`,
      ...seeds.slice(0, 3),
      `Think about the last time you dealt with this area (${goal.slice(0, 80)}). What happened?`,
      `What was the hardest part of that, and how did you work around it?`,
      `How do you evaluate and decide between options when buying a solution like this?`,
      `What would make you say no to a new tool, even if it looked promising?`,
      `If you could change one thing about how this works today, what would it be?`,
    ];
  } else {
    const { object } = await generateObject({
      model: model(), schema: guideSchema, system: P.GUIDE_SYSTEM, prompt: P.guideInput(goal, audience, seeds),
    });
    qs = object.questions;
  }
  qs = qs.map((q) => q.trim()).filter(Boolean);
  const filler = ["What does success look like for you here?", "Who else is involved in decisions like this?", "What did we not ask that we should have?"];
  for (const f of filler) if (qs.length < 5) qs.push(f);
  return qs.slice(0, 8);
}

// ---------- Interviewer ----------
export type TurnResult = { done: true } | { done: false; kind: "question" | "followup"; text: string };

export async function interviewerTurn(args: {
  title: string; goal: string; questions: string[]; transcript: Turn[]; askedCount: number; followedUp: boolean;
}): Promise<TurnResult> {
  const { questions, transcript, askedCount, followedUp } = args;
  const last = transcript[transcript.length - 1];
  if (mock()) {
    if (last?.role === "user" && words(last.content) < 6 && !followedUp && askedCount > 0 && askedCount <= questions.length) {
      return { done: false, kind: "followup", text: "Thanks. Could you say a bit more about that, maybe with a concrete example?" };
    }
    if (askedCount >= questions.length) return { done: true };
    return { done: false, kind: "question", text: questions[askedCount] };
  }
  // Guard in code too: never ask beyond the guide.
  const needsFollowCheck = last?.role === "user";
  if (askedCount >= questions.length && (followedUp || !needsFollowCheck)) return { done: true };
  const { text } = await generateText({
    model: model(),
    system: P.interviewerSystem(args.title, args.goal, questions, askedCount, followedUp),
    messages: transcript.length ? transcript.map((t) => ({ role: t.role, content: t.content })) : [{ role: "user", content: "(The participant has just joined. Greet them briefly and ask the first guide question.)" }],
    maxOutputTokens: 400,
  });
  const t = text.trim();
  if (t.includes(DONE)) return { done: true };
  if (t.startsWith("[FOLLOWUP]") && !followedUp) return { done: false, kind: "followup", text: t.replace("[FOLLOWUP]", "").trim() };
  if (askedCount >= questions.length) return { done: true };
  return { done: false, kind: "question", text: t.replace("[FOLLOWUP]", "").trim() };
}

export async function greeting(args: { title: string; goal: string; questions: string[] }): Promise<string> {
  const intro = `Hi, and thanks for joining! I'm an AI researcher running a short interview for "${args.title}". There are no right or wrong answers.`;
  if (mock()) return `${intro} Let's start: ${args.questions[0]}`;
  const r = await interviewerTurn({ ...args, transcript: [], askedCount: 0, followedUp: false });
  return r.done ? `${intro} ${args.questions[0]}` : r.text;
}

export const THANKS = "Thank you so much for your time and candid answers. That's everything I needed. You can close this window now.";

// ---------- Synthetic panel ----------
const MOCK_PERSONAS: Persona[] = [
  { name: "Priya Raman", role: "Head of Product Marketing", context: "Series B SaaS, 120 people, small research budget", attitude: "Enthusiastic but time-poor" },
  { name: "Marcus Webb", role: "VP Growth", context: "Mid-market fintech, board pressure on CAC", attitude: "Skeptical of anything that is not measurable" },
  { name: "Elena Fischer", role: "Founder / CEO", context: "Seed-stage startup, no dedicated researcher", attitude: "Pragmatic, wants fast answers" },
  { name: "Dev Patel", role: "Senior Product Manager", context: "Enterprise software, many stakeholders", attitude: "Cautious, process oriented" },
  { name: "Sofia Alvarez", role: "Marketing Director", context: "DTC brand, agency-heavy", attitude: "Curious but burned by past tools" },
  { name: "Tom Becker", role: "Strategy Lead", context: "Consulting firm, client-driven timelines", attitude: "Price sensitive" },
  { name: "Aiko Tanaka", role: "UX Research Manager", context: "Large org, strict compliance", attitude: "Skeptical of AI-run interviews" },
  { name: "Liam O'Connor", role: "Sales Enablement Lead", context: "Scale-up, 40 reps", attitude: "Wants battlecards, not reports" },
];

export async function generatePersonas(goal: string, audience: string, n: number): Promise<Persona[]> {
  if (mock()) return Array.from({ length: n }, (_, i) => MOCK_PERSONAS[i % MOCK_PERSONAS.length]);
  const { object } = await generateObject({ model: model(), schema: personasSchema, prompt: P.personasPrompt(goal, audience, n) });
  return object.personas.slice(0, n);
}

export async function personaAnswer(persona: Persona, question: string, transcript: Turn[]): Promise<string> {
  if (mock()) {
    const variants = [
      `Honestly, for me as ${persona.role.toLowerCase()} it comes down to speed and trust. When I was asked about "${question.slice(0, 50)}", the first thing I think of is how long it takes to get a credible answer. Right now we mostly guess or rely on a few sales calls.`,
      `It's messy today. We use a mix of surveys and anecdotes from the sales team, and ${persona.context.toLowerCase()} means nobody owns it. I would pay for something that gave me evidence I can show my leadership, but I worry about the cost and whether the data is real.`,
      `I'd say the biggest friction is stakeholder buy-in. I can find answers, but convincing the team takes weeks. A tool has to prove accuracy first, otherwise I won't risk my credibility on it.`,
    ];
    return variants[hash(persona.name + question) % variants.length];
  }
  const { text } = await generateText({
    model: model(), system: P.personaSystem(persona),
    messages: [...transcript.map((t) => ({ role: (t.role === "assistant" ? "user" : "assistant") as "user" | "assistant", content: t.content })), ...(transcript.length === 0 ? [{ role: "user" as const, content: question }] : [])],
    maxOutputTokens: 300,
  });
  return text.trim();
}

// ---------- Synthesis ----------
export async function synthesize(args: {
  title: string; goal: string; interviews: { id: string; participant: string; turns: Turn[] }[];
}): Promise<BuyerModel> {
  if (mock()) {
    const ids = args.interviews.map((i) => i.id);
    const quoteOf = (i: number) => {
      const iv = args.interviews[i % args.interviews.length];
      const ans = iv.turns.filter((t) => t.role === "user");
      const a = ans[(i + 1) % Math.max(ans.length, 1)]?.content ?? "";
      return { interview_id: iv.id, quote: a.split(/(?<=[.!?])\s/)[0].slice(0, 220) };
    };
    return {
      summary: `Mock synthesis of ${ids.length} interviews for "${args.title}". Buyers want credible, fast evidence and are wary of unverified data.`,
      themes: [
        { title: "Speed to credible evidence", description: "Participants value fast answers they can defend internally.", evidence: [quoteOf(0), quoteOf(1)] },
        { title: "Trust and data quality", description: "Skepticism about whether tool output reflects real buyers.", evidence: [quoteOf(1), quoteOf(2)] },
        { title: "Stakeholder buy-in", description: "Getting leadership to act on findings is the real bottleneck.", evidence: [quoteOf(2), quoteOf(3)] },
      ],
      objections: ["Is the data real and representative?", "Cost relative to current ad-hoc methods", "Risk to personal credibility if wrong"],
      jobs_to_be_done: ["Get a defensible answer about buyers within days", "Convince leadership with evidence", "Reduce reliance on anecdotes from sales"],
      segments: [
        { name: "Time-poor marketers", description: "Small teams needing fast insight.", share_estimate: "~40%" },
        { name: "Metric-driven skeptics", description: "Growth leaders who demand measurable proof.", share_estimate: "~35%" },
        { name: "Process-heavy enterprise PMs", description: "Need compliance and stakeholder alignment.", share_estimate: "~25%" },
      ],
      recommended_messages: ["Get a defensible buyer answer in days, not weeks", "Every insight links back to the interview it came from"],
    };
  }
  const transcripts = args.interviews
    .map((i) => `### Interview ${i.id} (${i.participant})\n${i.turns.map((t) => `${t.role === "assistant" ? "Interviewer" : "Participant"}: ${t.content}`).join("\n")}`)
    .join("\n\n");
  const { object } = await generateObject({
    model: model(), schema: buyerModelSchema, system: P.SYNTH_SYSTEM, prompt: P.synthInput(args.title, args.goal, transcripts), maxOutputTokens: 6000,
  });
  return object;
}

// ---------- Ask ----------
export type Chunk = { id: string; interview_id: string; participant: string; text: string };

export async function answerFromChunks(question: string, chunks: Chunk[]): Promise<string> {
  if (mock()) {
    if (!chunks.length) return "The interview transcripts do not cover this question.";
    const bullets = chunks.slice(0, 3).map((c) => {
      const a = c.text.split("\n").slice(1).join(" ").slice(0, 200);
      return `- ${c.participant}: "${a}" [int:${c.interview_id}]`;
    });
    return `Mock answer to "${question}". Based on ${chunks.length} retrieved excerpts:\n${bullets.join("\n")}\nTopics not present in these excerpts are not covered.`;
  }
  const excerpts = chunks.map((c) => `[int:${c.interview_id}] (${c.participant})\n${c.text}`).join("\n\n");
  const { text } = await generateText({ model: model(), system: P.ASK_SYSTEM, prompt: P.askInput(question, excerpts), maxOutputTokens: 1200 });
  return text.trim();
}

// ---------- Simulate ----------
export async function simulate(buyerModel: BuyerModel, stimulus: string): Promise<Reaction[]> {
  let out: Reaction[];
  if (mock()) {
    const segs = buyerModel.segments.length ? buyerModel.segments : [{ name: "General buyer", description: "", share_estimate: "" }];
    const names = Array.from({ length: Math.max(3, Math.min(5, segs.length)) }, (_, i) => segs[i]?.name ?? `${segs[i % segs.length].name} (variant ${i + 1})`);
    out = names.map((segment, i) => {
      const sentiment = [1, -1, 0, 2, -2][(hash(stimulus) + i) % 5];
      return {
        segment, sentiment,
        reaction: `${segment} would ${sentiment > 0 ? "likely welcome" : sentiment < 0 ? "push back on" : "be lukewarm about"} "${stimulus.slice(0, 80)}".`,
        likely_objection: buyerModel.objections[i % Math.max(buyerModel.objections.length, 1)] ?? "Unclear value",
        quote_style_example: `"I'd need to see proof before I commit to this."`,
      };
    });
  } else {
    const { object } = await generateObject({
      model: model(), schema: simulationSchema, system: P.SIM_SYSTEM, prompt: P.simInput(JSON.stringify(buyerModel), stimulus), maxOutputTokens: 3000,
    });
    out = object.reactions;
  }
  return out.slice(0, 5).map((r) => ({ ...r, sentiment: Math.max(-2, Math.min(2, Math.round(r.sentiment))) }));
}

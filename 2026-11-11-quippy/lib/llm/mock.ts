// Deterministic fake LLM used when ANTHROPIC_API_KEY is unset or LLM_MOCK=1.
import { verdictScore } from "../logic";
import type { DrillLLM, Feedback, Message, Pattern, Scenario, ScenarioDraft, Verdict } from "../schemas";

const PARTNER_LINES: Record<string, string[]> = {
  "s1-opener": [
    "Oh, this line never moves. Long morning?",
    "Ha, fair. I come here every day and they still misspell my name.",
    "Maya. And you, are you a regular or just passing through?",
    "That sounds fun, honestly. What got you into that?",
    "I like that. I should try it sometime.",
    "Well, that's my cup. It was nice chatting with you.",
    "Take care, hope the day gets better.",
  ],
  "s2-followup": [
    "Oh hey. Yeah, I went hiking up north last weekend.",
    "It was good. Bit crowded at the summit though.",
    "Mostly solo, sometimes with my brother. You hike?",
    "Nice. That trail has great views if you go early.",
    "Yeah, I'd be up for sharing a few trail ideas.",
    "Cool, I should get back to my desk.",
    "Catch you later.",
  ],
  "s3-invite": [
    "Hey, what's up? I have to run to the library in a minute.",
    "Hm, that depends. What did you have in mind?",
    "Thursday could work, but I'm not sure about the time.",
    "That's a bit early for me, honestly.",
    "Okay, that actually sounds doable.",
    "Alright, text me the details and I'll try to make it.",
    "See you then, maybe.",
  ],
  "s4-yes": [
    "Hey! We're having a small birthday dinner next Friday, would you like to come?",
    "Great, we'd love to have you. It's just six of us.",
    "Oh, that's kind of you. Maybe a dessert?",
    "Perfect. It starts around seven.",
    "She'll be so pleased you're coming.",
    "Alright, see you Friday then.",
    "Take care!",
  ],
  "s5-date": [
    "So, I'll admit I'm a little nervous. This is the part where we pretend we're relaxed, right?",
    "Ha, okay. So what do you do when you're not on apps like this?",
    "That sounds like a good way to spend a weekend.",
    "Mm, I'm not sure I know what you mean yet. Tell me more.",
    "I like that you said that. Most people dodge it.",
    "I'm having a good time, honestly.",
    "Would you want to do this again sometime?",
  ],
  "s6-reconnect": [
    "Wow. Hi. I didn't expect to hear from you.",
    "Yeah, it has been a while. Two years, I think.",
    "I'm okay. The move has been a lot, to be honest.",
    "That's fair. I guess we both let it slide.",
    "I'd like that, actually. When were you thinking?",
    "Okay. Send me a time and I'll try to make it work.",
    "It's good to hear your voice.",
  ],
  "s7-real": [
    "Long week, huh. How are you actually doing?",
    "Come on, you said fine like it was a reflex. What's really going on?",
    "That sounds heavy. Thank you for telling me.",
    "What do you need right now, advice or just someone to listen?",
    "I'm glad you said that out loud.",
    "I'm here, okay? Anytime.",
    "Let's grab dinner this weekend.",
  ],
  "s8-callhome": [
    "Oh, there you are! It's been two weeks, I was starting to worry. Are you eating properly?",
    "And work? Have you thought about asking for a raise?",
    "I'm only saying it because I care. Your cousin did that and it went very well.",
    "Hm. I suppose I can try to listen more. Tell me what's new, then.",
    "That's wonderful, honey. I'm proud of you.",
    "Okay, I'll let you go. Call me on Sunday?",
    "Love you, sweetheart.",
  ],
};

const GENERIC_LINES = [
  "Hi, good to see you. What's on your mind?",
  "Okay, go on, I'm listening.",
  "Hm, I see. Can you say a bit more about that?",
  "That makes sense to me. What would you like to happen next?",
  "I appreciate you being straightforward about it.",
  "Alright, let's leave it there for now.",
  "Thanks for talking, take care.",
];

export function mockPartnerLine(scenarioId: string, turn: number): string {
  const list = PARTNER_LINES[scenarioId] ?? GENERIC_LINES;
  return list[turn % list.length];
}

/** Streams a canned line word by word so the UI streaming path is exercised. */
export async function* mockPartnerStream(scenarioId: string, turn: number, delayMs = 25): AsyncGenerator<string> {
  const words = mockPartnerLine(scenarioId, turn).split(" ");
  for (let i = 0; i < words.length; i++) {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    yield (i === 0 ? "" : " ") + words[i];
  }
}

// ---- heuristic grader ----
export interface LineGrade {
  verdict: Verdict;
  pattern: Pattern;
  reason: string;
}

const wordCount = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
const HEDGES = /\b(maybe|i guess|kind of|sort of|i think maybe|if that's ok|if that is ok|probably|not sure)\b/i;
const DEFENSIVE = /\b(not my fault|you always|you never|whatever|that's not fair|i didn't do)\b/i;

export function gradeLine(text: string, scenarioType: string): LineGrade {
  const words = wordCount(text);
  if (/\bsorry\b/i.test(text)) return { verdict: "backfired", pattern: "over-apologising", reason: "Apologising signals you think you are in the wrong and hands the other person control of the moment." };
  if (words > 40) return { verdict: "backfired", pattern: "too-long", reason: "At over 40 words this is a speech; the other person has no room to join in." };
  if (DEFENSIVE.test(text)) return { verdict: "backfired", pattern: "defensive", reason: "This sounds like you are protecting yourself rather than connecting." };
  if (HEDGES.test(text)) return { verdict: "okay", pattern: "hedging", reason: "Softeners like 'maybe' or 'I guess' dilute what you actually want to say." };
  if (scenarioType === "The follow-up" && !text.includes("?")) return { verdict: "okay", pattern: "no-question-back", reason: "You shared something but did not ask a question, so the conversation has nowhere to go." };
  if (words <= 2) return { verdict: "okay", pattern: "vague-ask", reason: "Very short; there is not enough here for the other person to respond to." };
  return { verdict: "landed", pattern: "fine", reason: "Clear, natural and easy to respond to." };
}

export function mockStronger(text: string, scenario: Pick<Scenario, "goal" | "character">, pattern: Pattern): string {
  const goal = scenario.goal.charAt(0).toLowerCase() + scenario.goal.slice(1);
  switch (pattern) {
    case "over-apologising": {
      const cleaned = text.replace(/\b(i'?m |i am |so |really |very )*sorry( about that| for that)?[,.!]?\s*/gi, "").trim();
      return `Thanks for your time. ${cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : `What I'd like is to ${goal}.`}`;
    }
    case "too-long":
      return `Short version: I want to ${goal}. What do you think?`;
    case "hedging":
      return text.replace(new RegExp(HEDGES.source, "gi"), "").replace(/\s{2,}/g, " ").trim() || `I'd like to ${goal}.`;
    case "no-question-back":
      return `${text.trim().replace(/[.!]*$/, "")}. What about you, how was yours?`;
    case "defensive":
      return `That's fair, I hear you. Here's what I'd like to do: ${goal}.`;
    default:
      return `Here's what I'd like: ${goal}. Does that work for you?`;
  }
}

export function mockFeedback(scenario: Scenario, messages: Message[]): Feedback {
  const userLines = messages.filter((m) => m.role === "user");
  const lines = userLines.map((m) => {
    const g = gradeLine(m.text, scenario.type);
    return {
      index: m.index,
      verdict: g.verdict,
      reason: g.reason,
      pattern: g.pattern,
      ...(g.verdict !== "landed" ? { stronger: mockStronger(m.text, scenario, g.pattern) } : {}),
    };
  });
  const score = lines.length ? Math.round(lines.reduce((a, l) => a + verdictScore(l.verdict), 0) / lines.length) : 0;
  const weakest = [...lines].sort((a, b) => verdictScore(a.verdict) - verdictScore(b.verdict))[0];
  const tally = new Map<Pattern, number>();
  for (const l of lines) if (l.pattern !== "fine") tally.set(l.pattern, (tally.get(l.pattern) ?? 0) + 1);
  const pattern: Pattern = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "fine";
  const landed = lines.filter((l) => l.verdict === "landed").length;
  const summary =
    pattern === "fine"
      ? `You came across clear and natural; ${landed} of ${lines.length} lines landed. Keep practising to stay this relaxed under pressure.`
      : `${landed} of ${lines.length} lines landed, but your main pattern was ${pattern}. Work on your weakest line and notice when you slip into it.`;
  return {
    score,
    summary,
    weakestLineIndex: weakest?.index ?? 0,
    pattern,
    lines: lines.map((l) => ({ index: l.index, verdict: l.verdict, reason: l.reason, ...(l.stronger ? { stronger: l.stronger } : {}) })),
  };
}

export function mockDrill(scenario: Scenario, attempt: string, weakLine: string): DrillLLM {
  const g = gradeLine(attempt, scenario.type);
  const model = mockStronger(weakLine, scenario, gradeLine(weakLine, scenario.type).pattern);
  return {
    verdict: g.verdict,
    note: g.verdict === "landed" ? "Much better: direct, natural and easy to answer." : g.reason,
    model_answer: model,
  };
}

export function mockScenario(description: string): ScenarioDraft {
  const clean = description.trim().replace(/\s+/g, " ");
  const title = clean.split(" ").slice(0, 5).join(" ").replace(/[.,;:!?]+$/, "");
  return {
    title: title.charAt(0).toUpperCase() + title.slice(1),
    character: "Taylor",
    persona: "a realistic, somewhat busy person who responds honestly to what you say",
    setting: clean.slice(0, 200),
    stakes: "Something you care about getting right",
    goal: "Say what you actually want clearly and leave the conversation on good terms",
  };
}

import type { Pattern } from "./schemas";

export const FOCUS_INSTRUCTIONS: Record<Pattern, string> = {
  "over-apologising": "Create one natural moment that tempts them to over-apologise.",
  "vague-ask": "Ask them once what exactly they want, so a vague request gets exposed.",
  "no-question-back": "Share something about yourself and then wait, to see whether they ask you a question back.",
  "too-long": "Interrupt gently with a short reply if they go on for a long time, to test their concision.",
  hedging: "Respond more warmly to direct statements than to hedged ones such as 'maybe' or 'I guess'.",
  defensive: "Make one mildly critical remark that tempts them to get defensive.",
  monologue: "Stay quiet and brief so they have to carry the conversation without monologuing.",
  fine: "",
};

export const PATTERN_LABELS: Record<Pattern, string> = {
  "over-apologising": "Over-apologising",
  "vague-ask": "Vague ask",
  "no-question-back": "No question back",
  "too-long": "Too long",
  hedging: "Hedging",
  defensive: "Defensive",
  monologue: "Monologue",
  fine: "Fine",
};

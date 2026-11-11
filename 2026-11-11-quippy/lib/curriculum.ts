import type { Scenario, Unit } from "./schemas";

export const UNITS: Unit[] = [
  { id: "u1", order: 1, title: "Starting conversations", blurb: "Open a chat and keep it alive." },
  { id: "u2", order: 2, title: "Making plans", blurb: "Invite people in and say yes with warmth." },
  { id: "u3", order: 3, title: "Getting closer", blurb: "Dates and reconnections that feel real." },
  { id: "u4", order: 4, title: "Being real", blurb: "Honest answers and the calls that matter." },
];

export const SCENARIOS: Scenario[] = [
  {
    id: "s1-opener", unitId: "u1", order: 1, type: "The opener", title: "The opener",
    character: "Maya", persona: "a friendly stranger waiting for the same coffee order at a busy cafe",
    setting: "A crowded cafe at 8:30 on a weekday morning, both of you are waiting at the pickup counter",
    stakes: "Low, but a first impression you will not get again",
    goal: "Start a natural conversation and learn one thing about her",
  },
  {
    id: "s2-followup", unitId: "u1", order: 2, type: "The follow-up", title: "The follow-up",
    character: "Dev", persona: "a new coworker who answers politely but briefly unless asked real questions",
    setting: "The office kitchen, Dev just mentioned he went hiking last weekend",
    stakes: "Building a rapport with someone you will sit next to for a year",
    goal: "Keep the conversation going with curiosity, including a question back",
  },
  {
    id: "s3-invite", unitId: "u2", order: 1, type: "The invite", title: "The invite",
    character: "Priya", persona: "a classmate you like who is busy and a bit hard to pin down",
    setting: "After class, packing bags in the hallway",
    stakes: "A friendship that could go either way",
    goal: "Invite her to a specific plan with a day, a time and an easy out",
  },
  {
    id: "s4-yes", unitId: "u2", order: 2, type: "Saying yes", title: "Saying yes",
    character: "Sam", persona: "a neighbour who just invited you to a small birthday dinner",
    setting: "Over the fence in the front yard on a Saturday afternoon",
    stakes: "Accepting well makes you feel like part of the neighbourhood",
    goal: "Accept warmly, show real interest and ask what you can bring",
  },
  {
    id: "s5-date", unitId: "u3", order: 1, type: "The first date", title: "The first date",
    character: "Jordan", persona: "someone you matched with online, warm but observant, a little nervous",
    setting: "A quiet bar, fifteen minutes into a first date",
    stakes: "Whether there is a second date",
    goal: "Be yourself, share something real and show interest in Jordan",
  },
  {
    id: "s6-reconnect", unitId: "u3", order: 2, type: "The reconnect", title: "The reconnect",
    character: "Chris", persona: "an old close friend you have not spoken to in two years, slightly guarded",
    setting: "A phone call, you reached out after seeing their post about moving cities",
    stakes: "Rebuilding a friendship that faded without a fight",
    goal: "Reconnect honestly without over-explaining the silence and suggest a catch-up",
  },
  {
    id: "s7-real", unitId: "u4", order: 1, type: "The real answer", title: "The real answer",
    character: "Alex", persona: "a close friend who asks how you are doing and really wants a real answer",
    setting: "Walking home together after a long week",
    stakes: "Letting someone actually support you",
    goal: "Give an honest answer about how you are doing instead of saying fine",
  },
  {
    id: "s8-callhome", unitId: "u4", order: 2, type: "The call home", title: "The call home",
    character: "Mom", persona: "a loving, slightly worried parent who tends to give advice and ask lots of questions",
    setting: "Sunday evening video call, you have not called in two weeks",
    stakes: "A relationship that matters, and old habits that flare up",
    goal: "Have a warm call, share one real update and set a boundary on unsolicited advice",
  },
];

import { bandFor } from "./scoring";
import type { Band } from "./types";

export interface QuizOption { id: string; label: string; points: number }
export interface QuizQuestion {
  id: string; text: string; maxPoints: number; fix: string; options: QuizOption[];
}

// Max points sum to 100.
export const QUIZ: QuizQuestion[] = [
  {
    id: "passport_validity", text: "How long is your passport valid after your planned return date?", maxPoints: 20,
    fix: "Renew your passport first: most destinations want 3-6 months of validity after you travel.",
    options: [
      { id: "gt6", label: "More than 6 months", points: 20 },
      { id: "3to6", label: "3 to 6 months", points: 14 },
      { id: "lt3", label: "Less than 3 months", points: 0 },
    ],
  },
  {
    id: "previous_visas", text: "Have you held a Schengen, UK or US visa before?", maxPoints: 15,
    fix: "Without a visa history, make the rest of the file (funds, ties, bookings) especially clear.",
    options: [
      { id: "several", label: "Yes, several, and I complied with them", points: 15 },
      { id: "one", label: "Yes, one", points: 10 },
      { id: "none", label: "No, this is my first", points: 4 },
      { id: "refused", label: "I was refused before", points: 0 },
    ],
  },
  {
    id: "employment", text: "What is your current employment situation?", maxPoints: 15,
    fix: "Get an employer or university letter confirming your role and approved leave.",
    options: [
      { id: "employed", label: "Employed with an employer letter available", points: 15 },
      { id: "student", label: "Student with a university letter", points: 12 },
      { id: "self", label: "Self-employed with registration papers", points: 9 },
      { id: "none", label: "Not currently working or studying", points: 2 },
    ],
  },
  {
    id: "bank_balance", text: "What is your typical bank balance over the last 3 to 6 months?", maxPoints: 20,
    fix: "Show steady, explainable funds for the whole trip; avoid large unexplained last-minute deposits.",
    options: [
      { id: "high", label: "Comfortably above the trip cost", points: 20 },
      { id: "enough", label: "About equal to the trip cost", points: 13 },
      { id: "low", label: "Below the trip cost", points: 4 },
    ],
  },
  {
    id: "bookings", text: "Do you have flight and accommodation reservations that match your dates?", maxPoints: 15,
    fix: "Add a return flight reservation and a hotel booking that cover your exact dates.",
    options: [
      { id: "both", label: "Both, matching my dates", points: 15 },
      { id: "one", label: "Only one of them", points: 8 },
      { id: "none", label: "Neither yet", points: 2 },
    ],
  },
  {
    id: "travel_history", text: "How much have you travelled abroad in the last 5 years?", maxPoints: 10,
    fix: "Include old passport pages or past stamps to demonstrate a travel history.",
    options: [
      { id: "lots", label: "Several countries, always returned on time", points: 10 },
      { id: "some", label: "One or two trips", points: 6 },
      { id: "none", label: "None", points: 2 },
    ],
  },
  {
    id: "insurance", text: "Do you have travel medical insurance for the whole trip?", maxPoints: 5,
    fix: "Buy travel medical insurance with enough cover (EUR 30,000 for Schengen) for the full dates.",
    options: [
      { id: "yes", label: "Yes", points: 5 },
      { id: "no", label: "Not yet", points: 0 },
    ],
  },
];

export function scoreQuiz(answers: Record<string, string>): { score: number; band: Band; fixes: string[] } {
  let score = 0;
  const gaps: { gap: number; fix: string }[] = [];
  for (const q of QUIZ) {
    const opt = q.options.find((o) => o.id === answers[q.id]);
    const pts = opt?.points ?? 0;
    score += pts;
    if (pts < q.maxPoints) gaps.push({ gap: q.maxPoints - pts, fix: q.fix });
  }
  gaps.sort((a, b) => b.gap - a.gap);
  return { score, band: bandFor(score), fixes: gaps.slice(0, 3).map((g) => g.fix) };
}

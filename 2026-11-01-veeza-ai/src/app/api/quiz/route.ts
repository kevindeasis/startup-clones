import { z } from "zod";
import { QUIZ, scoreQuiz } from "@/lib/quiz";
import { quizNarrative } from "@/lib/llm";
import { handleError, json } from "@/lib/http";
import { DISCLAIMER } from "@/lib/types";

const schema = z.object({ answers: z.record(z.string(), z.string()) });

export async function POST(req: Request) {
  try {
    const { answers } = schema.parse(await req.json());
    const missing = QUIZ.filter((q) => !answers[q.id] || !q.options.some((o) => o.id === answers[q.id]));
    if (missing.length) return json({ error: "Missing or invalid answers", questions: missing.map((q) => q.id) }, 400);
    const { score, band, fixes } = scoreQuiz(answers);
    const narrative = await quizNarrative({ score, band, fixes });
    return json({ score, band, narrative, fixes, disclaimer: DISCLAIMER });
  } catch (e) {
    return handleError(e);
  }
}

import { streamText } from 'ai';
import { getModel, MOCK_LLM } from '../llm';

type Msg = { role: 'user' | 'assistant'; content: string };
type Summary = {
  counts: { total: number; advanced: number; rejected: number; undecided: number; recommendations: Record<string, number> };
  candidates: { name: string; overall_score: number | null; recommendation: string | null; decision: string | null; decision_reason: string | null }[];
  per_criterion: { name: string; weight: number; avg_score: number | null }[];
};

const CAVEAT = '_Caveat: a pattern alone does not prove a cause._';

export function mockAnswer(q: string, s: Summary): string {
  const ql = q.toLowerCase();
  const ranked = [...s.candidates].filter((c) => c.overall_score != null).sort((a, b) => (b.overall_score! - a.overall_score!));
  if (/top|best|rank/.test(ql)) {
    return `**Top candidates (mock answer)**\n\n${ranked.slice(0, 3).map((c, i) => `${i + 1}. **${c.name}** - ${c.overall_score}/100, recommendation: ${c.recommendation}`).join('\n') || 'No reviewed candidates yet.'}\n\n${CAVEAT}`;
  }
  if (/criteri/.test(ql)) {
    const low = [...s.per_criterion].filter((c) => c.avg_score != null).sort((a, b) => a.avg_score! - b.avg_score!)[0];
    return `**Criterion filtering the most people (mock answer)**\n\n${low ? `"${low.name}" has the lowest average score (${low.avg_score}/5). It may be what is holding candidates back.` : 'No scores yet.'}\n\n${CAVEAT}`;
  }
  if (/hold/.test(ql)) {
    return `**On hold (mock answer)**\n\n${s.counts.recommendations.hold ?? 0} candidate(s) currently have a "hold" recommendation out of ${s.counts.total}.`;
  }
  return `**Pipeline overview (mock answer)**\n\n- Total candidates: ${s.counts.total}\n- Advanced: ${s.counts.advanced}, rejected: ${s.counts.rejected}, undecided: ${s.counts.undecided}\n- Recommendations: ${Object.entries(s.counts.recommendations).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}\n\nYour question was: "${q}".\n\n${CAVEAT}`;
}

/** Returns a streaming text Response; calls onDone(fullText) when finished. */
export function askPipeline(question: string, summary: Summary, history: Msg[], onDone: (text: string) => void): Response {
  if (MOCK_LLM) {
    const text = mockAnswer(question, summary);
    const enc = new TextEncoder();
    const chunks = text.match(/.{1,24}/gs) || [text];
    const stream = new ReadableStream({
      async start(ctrl) {
        for (const c of chunks) {
          ctrl.enqueue(enc.encode(c));
          await new Promise((r) => setTimeout(r, 5));
        }
        ctrl.close();
        onDone(text);
      },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  const system = `You are a hiring analytics assistant for one role. Answer using ONLY the pipeline summary JSON below. Answer in markdown, concisely. If you infer a cause from a pattern, say that a pattern alone does not prove a cause. Humans make final hiring decisions.

Pipeline summary:
${JSON.stringify(summary, null, 2)}`;
  const result = streamText({
    model: getModel(),
    system,
    messages: [...history, { role: 'user', content: question }],
    onFinish: ({ text }) => onDone(text),
  });
  return result.toTextStreamResponse();
}

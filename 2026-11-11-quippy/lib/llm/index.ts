// Single entry point for all LLM calls. API routes only import from here.
import { anthropic } from "@ai-sdk/anthropic";
import { createUIMessageStream, createUIMessageStreamResponse, generateText, Output, streamText } from "ai";
import { FOCUS_INSTRUCTIONS } from "../patterns";
import { normalizeFeedback } from "../logic";
import {
  DrillLLMSchema, FeedbackLLMSchema, OPENING_SENTINEL, ScenarioDraftSchema,
  type DrillLLM, type Feedback, type Message, type Pattern, type Scenario, type ScenarioDraft,
} from "../schemas";
import { mockDrill, mockFeedback, mockPartnerStream, mockScenario } from "./mock";
import { COACH_SYSTEM, customScenarioPrompt, drillPrompt, feedbackPrompt, partnerSystemPrompt } from "./prompts";

export const isMock = () => process.env.LLM_MOCK === "1" || !process.env.ANTHROPIC_API_KEY;
const model = () => anthropic(process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5");

/**
 * Streams the scene partner's reply as an AI SDK UI message stream.
 * `history` is the persisted transcript (including the latest user line).
 * `onFinish` receives the full partner line and is awaited before the stream closes.
 */
export async function streamPartnerReply(opts: {
  scenario: Scenario;
  focus?: Pattern;
  history: Message[];
  onFinish: (text: string) => Promise<void>;
}): Promise<Response> {
  const { scenario, focus, history, onFinish } = opts;
  const id = "partner-" + Date.now();
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      if (isMock()) {
        const turn = history.filter((m) => m.role === "user").length;
        let text = "";
        writer.write({ type: "text-start", id });
        for await (const chunk of mockPartnerStream(scenario.id, turn)) {
          text += chunk;
          writer.write({ type: "text-delta", id, delta: chunk });
        }
        writer.write({ type: "text-end", id });
        await onFinish(text);
        return;
      }
      const system = partnerSystemPrompt(scenario, focus ? FOCUS_INSTRUCTIONS[focus] : "");
      const result = streamText({
        model: model(),
        system,
        temperature: 0.8,
        maxOutputTokens: 150,
        messages: [
          { role: "user", content: OPENING_SENTINEL },
          ...history.map((m) => ({ role: m.role === "user" ? ("user" as const) : ("assistant" as const), content: m.text })),
        ],
      });
      writer.merge(result.toUIMessageStream());
      await onFinish(await result.text);
    },
    onError: () => "The scene partner is unavailable. Please try again.",
  });
  return createUIMessageStreamResponse({ stream });
}

export async function generateFeedback(opts: { scenario: Scenario; messages: Message[] }): Promise<{ feedback: Feedback; mock: boolean }> {
  const { scenario, messages } = opts;
  const userIndexes = messages.filter((m) => m.role === "user").map((m) => m.index);
  if (!isMock()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { output } = await generateText({
          model: model(),
          system: COACH_SYSTEM,
          prompt: feedbackPrompt(scenario, messages),
          temperature: 0.3,
          output: Output.object({ schema: FeedbackLLMSchema }),
        });
        const parsed = FeedbackLLMSchema.safeParse(output);
        if (parsed.success) {
          const fb = normalizeFeedback(parsed.data, userIndexes);
          if (fb) return { feedback: fb, mock: false };
        }
      } catch (err) {
        console.error("feedback attempt failed", attempt, err instanceof Error ? err.message : err);
      }
    }
  }
  return { feedback: mockFeedback(scenario, messages), mock: true };
}

export async function gradeDrill(opts: {
  scenario: Scenario; partnerLine: string; weakLine: string; reason: string; attempt: string;
}): Promise<{ result: DrillLLM; mock: boolean }> {
  const { scenario, partnerLine, weakLine, reason, attempt } = opts;
  if (!isMock()) {
    for (let i = 0; i < 2; i++) {
      try {
        const { output } = await generateText({
          model: model(),
          system: COACH_SYSTEM,
          prompt: drillPrompt(scenario, partnerLine, weakLine, reason, attempt),
          temperature: 0.3,
          output: Output.object({ schema: DrillLLMSchema }),
        });
        const parsed = DrillLLMSchema.safeParse(output);
        if (parsed.success) return { result: parsed.data, mock: false };
      } catch (err) {
        console.error("drill attempt failed", i, err instanceof Error ? err.message : err);
      }
    }
  }
  return { result: mockDrill(scenario, attempt, weakLine), mock: true };
}

export async function generateCustomScenario(description: string): Promise<{ draft: ScenarioDraft; mock: boolean }> {
  if (!isMock()) {
    for (let i = 0; i < 2; i++) {
      try {
        const { output } = await generateText({
          model: model(),
          system: "You design realistic conversation-practice scenarios.",
          prompt: customScenarioPrompt(description),
          temperature: 0.7,
          output: Output.object({ schema: ScenarioDraftSchema }),
        });
        const parsed = ScenarioDraftSchema.safeParse(output);
        if (parsed.success) return { draft: parsed.data, mock: false };
      } catch (err) {
        console.error("custom scenario attempt failed", i, err instanceof Error ? err.message : err);
      }
    }
  }
  return { draft: mockScenario(description), mock: true };
}

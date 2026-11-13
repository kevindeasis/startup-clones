import { describe, expect, it } from "vitest";
import { classifyCoverage } from "../src/lib/coverage";
import { COMPLETE_MESSAGE, MAX_USER_TURNS, MOCK_QUESTIONS, nextMockReply, OPENING_MESSAGE } from "../src/lib/mock-interviewer";
import { AREAS, type Area, type ChatMessage } from "../src/lib/schemas";

describe("mock interviewer", () => {
  it("opens with the topic and walks every area, then closes and completes", async () => {
    const topic = "How is a quote made?";
    const history: ChatMessage[] = [{ role: "assistant", content: OPENING_MESSAGE(topic) }];
    const covered: Area[] = [];
    const replies: string[] = [];
    // Answers that deliberately do not trigger the keyword heuristic: the interviewer must still terminate.
    for (let i = 0; i < MAX_USER_TURNS + 3; i++) {
      history.push({ role: "user", content: "ok" });
      const reply = nextMockReply(history, covered, topic);
      replies.push(reply);
      history.push({ role: "assistant", content: reply });
      if (reply === COMPLETE_MESSAGE) break;
    }
    expect(replies.at(-1)).toBe(COMPLETE_MESSAGE);
    const asked = AREAS.filter((a) => history.some((m) => m.role === "assistant" && m.content.includes(MOCK_QUESTIONS[a])));
    expect(asked).toHaveLength(AREAS.length);
  });

  it("ends early with a closing question once all areas are covered", () => {
    const history: ChatMessage[] = [
      { role: "assistant", content: OPENING_MESSAGE("t") },
      { role: "user", content: "something" },
    ];
    const reply = nextMockReply(history, [...AREAS], "t");
    expect(reply).toContain("fix tomorrow");
  });

  it("classifies coverage with keywords", async () => {
    const areas = await classifyCoverage("I copy it manually into Excel and it is slow", []);
    expect(areas).toEqual(expect.arrayContaining(["manual_work", "tools", "pain_points"]));
  });
});

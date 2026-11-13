"use client";

import { useCallback, useEffect, useState } from "react";
import type { Area, ChatMessage, InterviewExtraction } from "../lib/schemas";

type InterviewState = {
  study: { title: string; topic: string };
  participant: { name: string; team: string; site: string; role: string; status: string };
  messages: ChatMessage[];
  coverage: Area[];
  extraction: InterviewExtraction | null;
};

/**
 * Minimal fetch + ReadableStream loop (the chat route streams plain text and
 * returns covered areas in the X-Coverage header).
 */
export function useInterviewChat(token: string) {
  const [state, setState] = useState<InterviewState | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/interviews/${token}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Interview link not found"))))
      .then(setState)
      .catch((e: Error) => setError(e.message));
  }, [token]);

  const send = useCallback(
    async (text: string) => {
      setError("");
      setStreaming(true);
      setState((s) => s && { ...s, messages: [...s.messages, { role: "user", content: text }, { role: "assistant", content: "" }] });
      try {
        const res = await fetch(`/api/interviews/${token}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text }),
        });
        if (!res.ok || !res.body) throw new Error("The interviewer could not reply. Please try again.");
        const coverage: Area[] = JSON.parse(res.headers.get("X-Coverage") ?? "[]");
        setState((s) => s && { ...s, coverage });
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let reply = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          reply += decoder.decode(value, { stream: true });
          setState((s) => s && { ...s, messages: [...s.messages.slice(0, -1), { role: "assistant", content: reply }] });
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      } finally {
        setStreaming(false);
      }
    },
    [token],
  );

  const finish = useCallback(async () => {
    setStreaming(true);
    const res = await fetch(`/api/interviews/${token}/finish`, { method: "POST" });
    setStreaming(false);
    if (!res.ok) {
      setError("Could not finish the interview.");
      return;
    }
    const extraction: InterviewExtraction = await res.json();
    setState((s) => s && { ...s, extraction, participant: { ...s.participant, status: "completed" } });
  }, [token]);

  return { state, streaming, error, send, finish };
}

import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { getModel } from "@/lib/brain/llm";
import { buildChatContext } from "@/lib/brain/chat";
import { getChat, saveChat } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const textOf = (m: UIMessage) => m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");

export async function POST(req: Request) {
  const { chatId, messages } = (await req.json()) as { chatId?: string; messages: UIMessage[] };
  const id = chatId && /^[\w-]+$/.test(chatId) ? chatId : `c_${Date.now().toString(36)}`;
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const { system } = buildChatContext(lastUser ? textOf(lastUser) : "");
  const { model } = getModel();
  const result = streamText({ model, system, messages: await convertToModelMessages(messages) });
  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    headers: { "x-chat-id": id },
    onFinish: ({ messages: all }) => {
      const existing = getChat(id);
      const first = all.find((m) => m.role === "user");
      saveChat({
        id,
        title: existing?.title ?? (first ? textOf(first).slice(0, 60) : "New chat"),
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        messages: all,
      });
    },
  });
}

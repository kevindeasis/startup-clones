import { notFound } from "next/navigation";
import { ChatView } from "../../components/ChatView";
import { getChat } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function ChatById({ params }: { params: Promise<{ id: string }> }) {
  const chat = getChat((await params).id);
  if (!chat) notFound();
  return <ChatView key={chat.id} id={chat.id} initial={chat.messages} />;
}

"use client";
import { useState } from "react";
import { ChatView } from "./ChatView";

export function NewChat() {
  const [id] = useState(() => `c_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`);
  return <ChatView id={id} initial={[]} />;
}

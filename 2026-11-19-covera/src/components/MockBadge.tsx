import { isMock } from "@/lib/llm";

export default function MockBadge() {
  if (!isMock()) return <span className="badge live">Live AI</span>;
  return <span className="badge mock">Mock mode — set ANTHROPIC_API_KEY for live AI</span>;
}

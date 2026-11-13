import { json } from "../../../lib/http";
import { isMockMode } from "../../../lib/llm";

export const dynamic = "force-dynamic";

export function GET() {
  return json({ ok: true, mock: isMockMode() });
}

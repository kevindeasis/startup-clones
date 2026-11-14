import { isMockMode, modelName } from "@/lib/llm";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = () => json({ ok: true, mock: isMockMode(), model: modelName() });

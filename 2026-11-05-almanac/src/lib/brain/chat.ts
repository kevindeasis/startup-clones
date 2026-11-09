import { chatSystem } from "./prompts";
import { getSource, listPages } from "../store";
import { rank } from "../text";

export function buildChatContext(question: string): { system: string; usedPages: string[] } {
  const pages = listPages();
  const overview = pages.find((p) => p.path === "overview.md");
  const rest = pages.filter((p) => p.path !== "overview.md");
  const top = rank(question, rest.map((p) => ({ p, text: `${p.title} ${p.body}` })))
    .filter((r) => r.score > 0)
    .slice(0, 4)
    .map((r) => r.doc.p);
  const company = overview?.body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "this company";
  const ids = [...question.matchAll(/(?:src:|source\s*#?\s*)(\d+)/gi)].map((m) => Number(m[1]));
  const raw = [...new Set(ids)].slice(0, 2).map((id) => getSource(id)).filter((s) => !!s)
    .map((s) => `<source id="${s!.id}" title=${JSON.stringify(s!.title)}>\n${s!.text.slice(0, 4000)}\n</source>`).join("\n");
  const system = chatSystem(company, overview?.body ?? "(the wiki is empty - nothing has been compiled yet)", top, pages.map((p) => `${p.title} (${p.path})`), raw);
  return { system, usedPages: ["overview.md", ...top.map((p) => p.path)] };
}

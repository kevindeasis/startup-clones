import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createTwoFilesPatch } from "diff";
import { blockText, getBlockHtml, hasBlock, replaceBlock, surroundingText } from "./html";
import * as cheerio from "cheerio";
import { Comment, Space, currentVersion, makeVersion, saveSpace, uid, now } from "./store";

export const MODEL = process.env.PADDOCK_MODEL || "claude-sonnet-5-5";
export const isMock = () => !process.env.ANTHROPIC_API_KEY;
export const MENTION = /@(paddock|spacesheep)\b/i;

const SYSTEM = `You are Paddock, an editor embedded in a shared HTML document. Rewrite ONLY the given HTML fragment according to the instruction. Keep the same outer tag and the \`data-block\` attribute. Keep inline styles/classes unless asked. Return a JSON object { "html": "...", "summary": "..." } and nothing else.`;

export function stripMention(body: string) {
  return body.replace(/@(paddock|spacesheep)\b[:,]?/gi, "").replace(/\s+/g, " ").trim();
}

function firstSentence(t: string) {
  const m = /^.*?[.!?](\s|$)/s.exec(t.trim());
  return (m ? m[0] : t.split(/\s+/).slice(0, 8).join(" ")).trim();
}
const titleCase = (t: string) => t.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

/** Deterministic mock: transforms the first/all text nodes of the fragment. */
export function mockEdit(fragment: string, instruction: string): { html: string; summary: string } {
  const $ = cheerio.load(fragment, null, false);
  const lower = instruction.toLowerCase();
  const textNodes: any[] = [];
  const walk = (n: any) => {
    if (n.type === "text" && n.data.trim()) textNodes.push(n);
    else if (n.children && !["script", "style"].includes(n.name)) n.children.forEach(walk);
  };
  $.root().children().each((_, el) => walk(el));
  const apply = (fn: (s: string) => string) => {
    let changed = false;
    for (const n of textNodes) { const o = n.data; n.data = fn(o); if (n.data !== o) changed = true; }
    return changed;
  };
  let changed = false;
  if (lower.includes("shorter") || lower.includes("shorten")) {
    if (textNodes.length) {
      const joined = textNodes.map((n) => n.data).join(" ");
      const keep = firstSentence(joined);
      if (keep.length < joined.trim().length) {
        textNodes[0].data = keep; textNodes.slice(1).forEach((n) => (n.data = ""));
        changed = true;
      }
    }
  } else if (lower.includes("title case")) changed = apply(titleCase);
  else if (lower.includes("uppercase") || lower.includes("upper case")) changed = apply((s) => s.toUpperCase());
  if (!changed && textNodes.length) {
    textNodes[0].data = `[edited: ${instruction.slice(0, 60)}] ` + textNodes[0].data.trimStart();
    changed = true;
  }
  if (!changed) { // no text: add a marker attribute so something visibly changes
    const first = $.root().children().first();
    first.attr("title", `[edited: ${instruction.slice(0, 60)}]`);
  }
  return { html: $.html(), summary: `Mock edit: ${instruction}` };
}

function parseModelJson(raw: string): { html: string; summary: string } | null {
  let t = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  try {
    const o = JSON.parse(t);
    if (o && typeof o.html === "string") return { html: o.html, summary: String(o.summary || "Edited by Paddock") };
  } catch {}
  return null;
}

async function llmEdit(fragment: string, instruction: string, context: string, thread: Comment[]) {
  const prompt = `Instruction: ${instruction}\n\nRecent thread:\n${thread.map((c) => `${c.author}: ${c.body}`).join("\n") || "(none)"}\n\nHTML fragment to rewrite:\n${fragment}\n\nSurrounding text for context:\n${context}`;
  let lastRaw = "";
  for (let i = 0; i < 2; i++) {
    const { text } = await generateText({ model: anthropic(MODEL), system: SYSTEM, prompt, temperature: 0.2 });
    lastRaw = text;
    const p = parseModelJson(text);
    if (p) return p;
  }
  if (lastRaw.trim().startsWith("<")) return { html: lastRaw.trim(), summary: "Edited by Paddock" };
  throw new Error("Model did not return valid JSON");
}

export type EditResult = { reply: Comment; version: number };

/** Run the @paddock pipeline. Caller must hold the space lock. */
export async function runEdit(space: Space, trigger: Comment): Promise<EditResult> {
  const block = trigger.block && hasBlock(currentVersion(space).html, trigger.block) ? trigger.block : null;
  const instruction = stripMention(trigger.body) || "improve this";
  const prev = currentVersion(space);
  const fragment = getBlockHtml(prev.html, block);
  const thread = space.comments.filter((c) => c.block === trigger.block && c.id !== trigger.id).slice(-5);
  const out = isMock()
    ? mockEdit(fragment, instruction)
    : await llmEdit(fragment, instruction, surroundingText(prev.html, block), thread);
  if (!out.html.trim()) throw new Error("Empty replacement");
  const newHtml = replaceBlock(prev.html, block, out.html);
  const v = makeVersion(space, newHtml, "ai", `@paddock: ${instruction}`);
  const oldT = blockText(prev.html, block), newT = blockText(v.html, block);
  let diff = createTwoFilesPatch(`v${prev.n}`, `v${v.n}`, oldT + "\n", newT + "\n", "", "", { context: 2 });
  diff = diff.split("\n").slice(2).join("\n").split("\n").slice(0, 40).join("\n");
  const reply: Comment = {
    id: uid(), block: trigger.block, author: "Paddock", kind: "agent", resolved: false, created_at: now(),
    parent_id: trigger.parent_id || trigger.id,
    body: out.summary,
    meta: { version_created: v.n, previous_version: prev.n, diff, summary: out.summary },
  };
  space.comments.push(reply);
  saveSpace(space);
  return { reply, version: v.n };
}

import { generateText } from "ai";
import { getModel, isMockMode } from "./llm";
import type { Change, Metrics } from "./monitor";

const sign = (n: number) => (n >= 0 ? "+" : "");
const describe = (c: Change) =>
  `**${c.label}**: ${c.previous.toLocaleString("en-US", { maximumFractionDigits: 1 })} -> ${c.current.toLocaleString("en-US", { maximumFractionDigits: 1 })} (${sign(c.deltaPct)}${c.deltaPct.toFixed(0)}%)`;

const NEXT_STEPS: Record<Change["kind"], (c: Change) => string> = {
  referrer: (c) => `Look at what ${c.label} visitors do after landing; double down on the channel if they convert, or fix the landing page if they bounce.`,
  page: (c) => `Check why \`${c.label}\` ${c.delta > 0 ? "gained" : "lost"} traffic and make sure its call to action is working.`,
  goal: (c) => `Review the path to "${c.label}" in Funnels; ${c.delta > 0 ? "find what drove the lift and repeat it" : "look for the step where visitors drop off"}.`,
  metric: (c) => `Investigate the ${c.delta > 0 ? "rise" : "drop"} in ${c.label.toLowerCase()} with the Bunny analyst ("what changed in ${c.label.toLowerCase()} last week?").`,
};

export function templateDigest(siteName: string, changes: Change[]): string {
  if (!changes.length) {
    return `## ${siteName}: a quiet week\n\nNo metric moved by 20% or more against the previous 7 days.\n\n### Suggested next steps\n- Keep shipping; re-run the check next week.\n- Add a goal or funnel so the next check has more to compare.\n`;
  }
  const top = changes[0];
  const bullets = changes.slice(0, 6).map((c) => `- ${describe(c)}`);
  const steps = [...new Map(changes.map((c) => [c.kind, c])).values()].slice(0, 3).map((c) => `- ${NEXT_STEPS[c.kind](c)}`);
  return `## ${siteName}: ${top.label} ${top.delta >= 0 ? "up" : "down"} ${Math.abs(top.deltaPct).toFixed(0)}% week over week\n\n### What changed\n${bullets.join("\n")}\n\n### Suggested next steps\n${steps.join("\n")}\n`;
}

export async function writeDigest(
  siteName: string,
  window: { from: string; to: string },
  changes: Change[],
  current: Metrics,
  previous: Metrics,
): Promise<string> {
  if (isMockMode()) return templateDigest(siteName, changes);
  const { text } = await generateText({
    model: getModel(),
    system:
      "You are Hutch Bunny, a product analytics monitor. Write a short Markdown digest for a startup founder: a headline (## ), 3-6 bullets of the most meaningful changes with exact numbers, then 2-3 suggested next steps. Use only the numbers provided.",
    prompt: JSON.stringify({ site: siteName, window, changes: changes.slice(0, 12), totals: { current: { ...current, pages: undefined, referrers: undefined }, previous: { ...previous, pages: undefined, referrers: undefined } } }),
  });
  return text.trim() || templateDigest(siteName, changes);
}

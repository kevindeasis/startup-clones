import { LINE_LABELS } from "./types";
import type { DraftContexts, DraftKind } from "./drafts";
import type { ComparisonDiff, Line } from "./types";

const usd = (n: number | undefined) => (n === undefined ? "n/a" : `$${n.toLocaleString("en-US")}`);

function row(diff: ComparisonDiff, id: string | undefined) {
  return diff.rows.find((r) => r.quoteId === id);
}

function followUp(ctx: DraftContexts["followUp"]): string {
  const name = ctx.profile.contactName?.split(" ")[0] ?? "there";
  if (ctx.missing.length === 0) {
    const ls = ctx.profile.requestedLines.map((l) => LINE_LABELS[l]).join(", ") || "your requested coverage";
    return [
      `Subject: We have what we need to quote ${ls}`,
      "",
      `Hi ${name},`,
      "",
      `Thank you${ctx.profile.businessName ? ` for sending over the details for ${ctx.profile.businessName}` : ""}. We have everything we need for ${ls}, and we are going to market with carriers now.`,
      "",
      "We will come back to you with side-by-side options as soon as the quotes are in.",
      "",
      "Best regards,",
      "Harbor Point Insurance",
    ].join("\n");
  }
  const bullets = ctx.missing.length
    ? ctx.missing.map((m) => `  - ${m.label}`).join("\n")
    : "  - (nothing further needed right now)";
  const lines = ctx.profile.requestedLines.map((l) => LINE_LABELS[l]).join(", ") || "your requested coverage";
  return [
    `Subject: A few details needed to quote ${lines}`,
    "",
    `Hi ${name},`,
    "",
    `Thanks for reaching out${ctx.profile.businessName ? ` on behalf of ${ctx.profile.businessName}` : ""}. To get accurate quotes for ${lines}, could you send over the following?`,
    "",
    bullets,
    "",
    "Once we have these we will go to market with the carriers and come back to you with side-by-side options.",
    "",
    "Best regards,",
    "Harbor Point Insurance",
  ].join("\n");
}

function lineSection(diff: ComparisonDiff, line: Line): string[] {
  const lc = diff.byLine.find((l) => l.line === line);
  if (!lc) return [];
  const cheap = row(diff, lc.cheapestQuoteId);
  const broad = row(diff, lc.broadestQuoteId);
  if (!cheap || !broad) return [];
  const out = [`${LINE_LABELS[line]}: ${lc.quoteIds.length} quote(s).`];
  out.push(`Cheapest is ${cheap.carrierName} at ${usd(cheap.premium)} with a ${usd(cheap.deductible)} deductible.`);
  if (broad.quoteId === cheap.quoteId) {
    out.push(`It is also the broadest option with ${cheap.coverages.length} included coverages.`);
  } else {
    out.push(
      `Broadest coverage is ${broad.carrierName} at ${usd(broad.premium)} with ${broad.coverages.length} coverages versus ${cheap.coverages.length} for the cheapest.`,
    );
  }
  return out;
}

function recommendation(ctx: DraftContexts["recommendation"]): string {
  const rec = row(ctx.diff, ctx.recommendedQuoteId);
  const sentences: string[] = [];
  for (const lc of ctx.diff.byLine) sentences.push(...lineSection(ctx.diff, lc.line));
  if (rec) {
    sentences.push(
      `We recommend ${rec.carrierName} for ${LINE_LABELS[rec.line]} at ${usd(rec.premium)} because it balances price and breadth of coverage.`,
    );
  }
  sentences.push("This is a recommendation only; nothing is bound until the broker confirms the selection with the client.");
  return sentences.join(" ");
}

function proposal(ctx: DraftContexts["proposal"]): string {
  const name = ctx.profile.contactName?.split(" ")[0] ?? "there";
  const rec = row(ctx.diff, ctx.recommendedQuoteId);
  const table = ctx.diff.rows
    .map(
      (r) =>
        `  - ${r.carrierName} / ${LINE_LABELS[r.line]}: ${usd(r.premium)} per year, ${usd(r.deductible)} deductible`,
    )
    .join("\n");
  return [
    `Subject: Your insurance options${ctx.profile.businessName ? ` - ${ctx.profile.businessName}` : ""}`,
    "",
    `Hi ${name},`,
    "",
    "We have gone to market and have the following options for you:",
    "",
    table,
    "",
    rec
      ? `Our recommendation is ${rec.carrierName} for ${LINE_LABELS[rec.line]} at ${usd(rec.premium)} per year, which includes: ${rec.coverages.join(", ")}.`
      : "Please review the options above and let us know which you prefer.",
    rec && rec.exclusions.length ? `Please note the exclusions: ${rec.exclusions.join(", ")}.` : "",
    "",
    "Let us know which option you would like and we will take care of the next steps. Nothing is bound until you confirm.",
    "",
    "Best regards,",
    "Harbor Point Insurance",
  ]
    .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
    .join("\n");
}

function outreach(ctx: DraftContexts["outreach"]): string {
  const { account, gap } = ctx;
  return [
    `Subject: Closing a coverage gap for ${account.name}`,
    "",
    `Hi ${account.name} team,`,
    "",
    `While reviewing your account we noticed a gap: ${gap.reason}.`,
    `Many ${ctx.industryName ?? account.industry} businesses in ${account.state} carry ${LINE_LABELS[gap.line]} alongside their existing policies, and adding it can protect you from uninsured losses.`,
    "",
    "Would you have 15 minutes this week for a quick call? We can price it with our carriers and show you options side by side.",
    "",
    "Best regards,",
    "Harbor Point Insurance",
  ].join("\n");
}

export function mockDraft<K extends DraftKind>(kind: K, context: DraftContexts[K]): string {
  switch (kind) {
    case "followUp":
      return followUp(context as DraftContexts["followUp"]);
    case "recommendation":
      return recommendation(context as DraftContexts["recommendation"]);
    case "proposal":
      return proposal(context as DraftContexts["proposal"]);
    case "outreach":
      return outreach(context as DraftContexts["outreach"]);
  }
  throw new Error(`Unknown draft kind: ${String(kind)}`);
}

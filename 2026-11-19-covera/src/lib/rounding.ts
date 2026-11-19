import { getIndustry } from "./data";
import { LINE_LABELS } from "./types";
import type { Account, Gap, Line } from "./types";

export function findGapsForAccount(account: Account): Gap[] {
  const has = new Set(account.policies.map((p) => p.line));
  const gaps = new Map<Line, Gap>();
  const add = (line: Line, reason: string) => {
    if (!has.has(line) && !gaps.has(line)) gaps.set(line, { accountId: account.id, line, reason });
  };
  // Special rules first: they carry the most specific reasons.
  if (account.employees >= 1) {
    add("wc", `${account.employees} employees but no workers' compensation policy on the book`);
  }
  if (account.industry === "restaurant" || account.industry === "bar") {
    add("liquor", "Restaurant/bar with no liquor liability policy");
  }
  if (account.industry === "e-commerce" || account.industry === "software") {
    add("cyber", `${getIndustry(account.industry)?.name ?? account.industry} business holding customer data with no cyber policy`);
  }
  const ind = getIndustry(account.industry);
  for (const line of ind?.recommendedLines ?? []) {
    add(line, `${LINE_LABELS[line]} is recommended for ${ind?.name} accounts and is missing`);
  }
  return [...gaps.values()];
}

export function findGaps(accounts: Account[]): Gap[] {
  return accounts.flatMap(findGapsForAccount);
}

import type { Attachment, Check, PermitType, Rule } from "./types";

type Fields = Record<string, string | number | boolean | undefined | null>;

function isBlank(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
}
function num(v: unknown): number | null {
  if (isBlank(v)) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function evaluateRule(rule: Rule, fields: Fields, attachments: Attachment[]): Check {
  const base = { id: rule.id, title: rule.title, citation: rule.citation, source: "rule" as const };
  const needs = (detail: string): Check => ({ ...base, status: "needs_info", detail });
  switch (rule.kind) {
    case "required_document": {
      const has = attachments.some((a) => a.kind === rule.document);
      const label = (rule.document ?? "").replace("_", " ");
      return has
        ? { ...base, status: "pass", detail: `A ${label} was provided.` }
        : needs(`No ${label} was provided; one is required.`);
    }
    case "required_field": {
      const v = fields[rule.field ?? ""];
      return isBlank(v)
        ? needs(`Field "${rule.field}" is blank.`)
        : { ...base, status: "pass", detail: `"${rule.field}" is provided (${String(v)}).` };
    }
    case "max":
    case "min": {
      const v = num(fields[rule.field ?? ""]);
      if (v === null) return needs(`Field "${rule.field}" is missing, so ${rule.title.toLowerCase()} cannot be verified.`);
      const limit = rule.value ?? 0;
      const ok = rule.kind === "max" ? v <= limit : v >= limit;
      return {
        ...base,
        status: ok ? "pass" : "fail",
        detail: `${rule.field} is ${v}; ${rule.kind === "max" ? "maximum" : "minimum"} allowed is ${limit}.`,
      };
    }
    case "ratio_max": {
      const n = num(fields[rule.numerator ?? ""]);
      const d = num(fields[rule.denominator ?? ""]);
      if (n === null || d === null || d === 0)
        return needs(`${rule.numerator} and ${rule.denominator} are both required to compute the ratio.`);
      const ratio = n / d;
      const limit = rule.value ?? 0;
      return {
        ...base,
        status: ratio <= limit ? "pass" : "fail",
        detail: `${rule.numerator}/${rule.denominator} is ${ratio.toFixed(3)}; maximum allowed is ${limit}.`,
      };
    }
  }
}

export function runRules(permit: PermitType, fields: Fields, attachments: Attachment[]): Check[] {
  return permit.rules.map((r) => evaluateRule(r, fields, attachments));
}

export function summarizeChecks(checks: Check[]) {
  return {
    pass: checks.filter((c) => c.status === "pass").length,
    fail: checks.filter((c) => c.status === "fail").length,
    needs_info: checks.filter((c) => c.status === "needs_info").length,
  };
}

// The only module that talks to a model. Live mode uses @ai-sdk/anthropic;
// mock mode uses deterministic templates (no randomness).
import { createAnthropic } from "@ai-sdk/anthropic";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateObject,
  generateText,
  streamText,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { getPermitType } from "./permits";
import { summarizeChecks } from "./rules";
import type { Application, Check, CodeSection, PermitType, Recommendation } from "./types";
import { REPORT_SYSTEM, reportPrompt } from "./prompts";

export function isMock(): boolean {
  return process.env.LLM_MOCK === "1" || !process.env.ANTHROPIC_API_KEY;
}

export function modelName(): string {
  return process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
}

function model() {
  const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropic(modelName());
}

/* ------------------------------ schemas ------------------------------ */

export const reviewAiSchema = z.object({
  summary: z.string(),
  recommendation: z.enum(["approve", "approve_with_conditions", "request_info", "deny"]),
  conditions: z.array(z.string()),
  extraChecks: z.array(
    z.object({
      title: z.string(),
      status: z.enum(["pass", "fail", "needs_info"]),
      citation: z.string(),
      detail: z.string(),
    }),
  ),
});
export type ReviewAi = z.infer<typeof reviewAiSchema>;

/* ------------------------------ core API ------------------------------ */

/** Streams a chat answer as a UI message stream Response (works with useChat). */
export async function streamChat(opts: {
  system: string;
  messages: UIMessage[];
  headers?: Record<string, string>;
  /** Used in mock mode: the deterministic answer to stream. */
  mockText?: string;
}): Promise<Response> {
  if (isMock()) {
    const text = opts.mockText ?? "Mock mode: no answer available.";
    const stream = createUIMessageStream({
      execute: ({ writer }) => {
        writer.write({ type: "text-start", id: "t1" });
        const words = text.split(/(\s+)/);
        for (let i = 0; i < words.length; i += 6) {
          writer.write({ type: "text-delta", id: "t1", delta: words.slice(i, i + 6).join("") });
        }
        writer.write({ type: "text-end", id: "t1" });
      },
    });
    return createUIMessageStreamResponse({ stream, headers: opts.headers });
  }
  const result = streamText({
    model: model(),
    system: opts.system,
    messages: await convertToModelMessages(opts.messages),
  });
  return result.toUIMessageStreamResponse({ headers: opts.headers });
}

/** Structured output validated by zod. In mock mode runs `mock()` and validates it. */
export async function structured<T>(opts: {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  mock: () => T;
}): Promise<T> {
  if (isMock()) return opts.schema.parse(opts.mock());
  const { object } = await generateObject({
    model: model(),
    schema: opts.schema,
    system: opts.system,
    prompt: opts.prompt,
  });
  return object as T;
}

export async function generateReport(app: Application): Promise<string> {
  if (isMock()) return mockReport(app);
  const { text } = await generateText({ model: model(), system: REPORT_SYSTEM, prompt: reportPrompt(app) });
  return text;
}

/* ------------------------------ mock templates ------------------------------ */

export function mockDiscoveryAnswer(
  query: string,
  sections: CodeSection[],
  permits: { permit: PermitType; score: number }[],
): string {
  const lines: string[] = [];
  if (permits.length === 0) {
    lines.push(
      "I could not match your project to a specific permit type yet. Could you tell me what you want to build (for example a fence, deck, ADU, addition, sign, or home business), where on the lot, and how big it is?",
    );
  } else {
    const top = permits.slice(0, 3);
    lines.push(`Based on what you described ("${query.trim().slice(0, 120)}"), you likely need:`);
    for (const { permit } of top) {
      const docs = permit.requiredDocuments.map((d) => d.replace("_", " ")).join(", ") || "no attachments";
      lines.push(`- **${permit.name}** (${permit.id}): ${permit.description} Required documents: ${docs}.`);
    }
  }
  if (sections.length) {
    lines.push("", "Relevant code sections:");
    for (const s of sections.slice(0, 3)) {
      lines.push(`- [§ ${s.id}] ${s.title}: ${s.text.split(". ")[0].replace(/\.$/, "")}.`);
    }
  }
  lines.push("", "Use the Start application button on the right to begin your application.");
  return lines.join("\n");
}

export function mockPrecheckAdvice(checks: Check[]): string {
  const fails = checks.filter((c) => c.status === "fail");
  const needs = checks.filter((c) => c.status === "needs_info");
  if (!fails.length && !needs.length) return "Your application looks complete. You can submit it.";
  const parts: string[] = [];
  for (const c of needs) parts.push(`Missing: ${c.title} (${c.detail}) [§ ${c.citation}].`);
  for (const c of fails) parts.push(`Conflict: ${c.title}. ${c.detail} [§ ${c.citation}].`);
  return parts.join(" ");
}

export function mockReviewObject(app: Application, checks: Check[]): ReviewAi {
  const counts = summarizeChecks(checks);
  const extra: ReviewAi["extraChecks"] = [];
  const d = app.projectDescription.toLowerCase();
  const heightBlank = app.fields.heightFt === undefined || app.fields.heightFt === "";
  if (/second[- ]story|second floor|two[- ]story/.test(d) && heightBlank) {
    extra.push({
      title: "Description mentions a second story but height is blank",
      status: "needs_info",
      citation: "17.28.020",
      detail: "Second-story additions require elevations and a stated building height.",
    });
  }
  if (/\btree/.test(d)) {
    extra.push({
      title: "Description mentions trees; tree removal permit may be needed",
      status: "needs_info",
      citation: "17.44.010",
      detail: "Protected trees (12 inch trunk or larger) need a separate tree removal permit.",
    });
  }
  if (app.attachments.length === 0) {
    extra.push({
      title: "No attachments uploaded",
      status: "needs_info",
      citation: "17.50.010",
      detail: "The application has no supporting documents attached.",
    });
  }
  const conditions: string[] = [];
  const failed = checks.filter((c) => c.status === "fail");
  const needed = checks.filter((c) => c.status === "needs_info");
  let recommendation: Recommendation;
  if (needed.length || extra.some((e) => e.status === "needs_info")) recommendation = "request_info";
  else if (failed.length) recommendation = "deny";
  else recommendation = "approve";
  if (recommendation === "approve" && app.permitType === "deck" && Number(app.fields.heightAboveGradeIn) > 30) {
    conditions.push("Guardrails are required where the walking surface is more than 30 inches above grade (17.26.010).");
    recommendation = "approve_with_conditions";
  }
  if (recommendation === "approve") conditions.push("Standard conditions: work must conform to the approved plans.");
  for (const c of failed) conditions.push(`Revise the plans to resolve: ${c.title} [§ ${c.citation}], or apply for a variance (17.56.010).`);
  for (const c of needed) conditions.push(`Provide: ${c.title} [§ ${c.citation}].`);
  const summary =
    `Application ${app.id} (${getPermitType(app.permitType)?.name ?? app.permitType}) at ${app.address} was checked against ${checks.length} code requirements: ` +
    `${counts.pass} passed, ${counts.fail} failed, ${counts.needs_info} need more information. ` +
    (failed.length ? `Failing: ${failed.map((c) => `${c.title} [§ ${c.citation}]`).join("; ")}. ` : "") +
    (needed.length ? `Missing information: ${needed.map((c) => c.title).join("; ")}. ` : "") +
    `Recommendation: ${recommendation.replace(/_/g, " ")}.`;
  return { summary, recommendation, conditions, extraChecks: extra };
}

export function mockReport(app: Application): string {
  const permit = getPermitType(app.permitType);
  const r = app.review;
  const checks = r?.checks ?? [];
  const failed = checks.filter((c) => c.status === "fail");
  const hearing = failed.length > 0 || app.permitType === "addition";
  const rows = checks.length
    ? checks.map((c) => `| ${c.title} | ${c.status} | § ${c.citation} | ${c.detail.replace(/\|/g, "/")} |`).join("\n")
    : "| (review not yet run) | - | - | - |";
  return [
    `# Staff Report: ${permit?.name ?? app.permitType} - ${app.address}`,
    "",
    `Application ${app.id} | Applicant: ${app.applicant.name} | Planning Commission memo`,
    "",
    "## Summary",
    r?.summary ?? "No review has been run for this application yet.",
    "",
    "## Project Description",
    app.projectDescription,
    "",
    "## Site & Zoning",
    `- Address: ${app.address}${app.parcel ? ` (parcel ${app.parcel})` : ""}`,
    `- Zoning district: ${app.zoning}`,
    ...Object.entries(app.fields).map(([k, v]) => `- ${k}: ${String(v)}`),
    "",
    "## Analysis of Checks",
    "| Check | Status | Citation | Detail |",
    "| --- | --- | --- | --- |",
    rows,
    "",
    "## Public Notice",
    hearing
      ? "Planning Commission review is required (§ 17.54.020). Notice must be mailed to owners within 300 feet at least 10 days before the hearing and posted on site (§ 17.54.010)."
      : "No public hearing is required; the application is eligible for administrative approval by staff (§ 17.54.020).",
    "",
    "## Recommendation",
    `Staff recommends: **${(r?.recommendation ?? "request_info").replace(/_/g, " ")}**.`,
    "",
    "## Conditions",
    ...((r?.conditions.length ? r.conditions : ["None."]).map((c, i) => `${i + 1}. ${c}`)),
    "",
  ].join("\n");
}

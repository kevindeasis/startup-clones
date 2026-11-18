import type { Application, Check, CodeSection, PermitType } from "./types";

export function discoverySystem(sections: CodeSection[], permits: PermitType[]): string {
  return [
    "You are the City of Pinecrest permit assistant. Answer only from the code sections provided; cite sections as [§ id]. Say which permit types apply and what documents are needed. If unsure, say what you need to know.",
    "",
    "CODE SECTIONS:",
    ...sections.map((s) => `[§ ${s.id}] ${s.title}: ${s.text}`),
    "",
    "CANDIDATE PERMIT TYPES:",
    ...permits.map(
      (p) => `- ${p.id}: ${p.name} - ${p.description} Required documents: ${p.requiredDocuments.join(", ") || "none"}.`,
    ),
  ].join("\n");
}

export const REVIEW_SYSTEM =
  "You are a City of Pinecrest plan reviewer assistant. You receive an application, deterministic rule check results and the cited code text. Produce a summary, a recommendation, conditions of approval, and extraChecks about things the rules cannot see (project description, attachment text). You must not change or contradict rule check statuses.";

export function reviewPrompt(app: Application, checks: Check[], sections: CodeSection[]): string {
  return [
    `APPLICATION ${app.id} (${app.permitType}) at ${app.address}, zoning ${app.zoning}`,
    `Description: ${app.projectDescription}`,
    `Fields: ${JSON.stringify(app.fields)}`,
    `Attachments: ${app.attachments.map((a) => `${a.filename} [${a.kind}]: ${a.text.slice(0, 500)}`).join(" | ") || "none"}`,
    "",
    "RULE RESULTS:",
    ...checks.map((c) => `- (${c.status}) ${c.title} [§ ${c.citation}]: ${c.detail}`),
    "",
    "CODE TEXT:",
    ...sections.map((s) => `[§ ${s.id}] ${s.title}: ${s.text}`),
  ].join("\n");
}

export const PRECHECK_SYSTEM =
  "You help City of Pinecrest residents complete permit applications. Given check results, write brief friendly advice listing what to fix before submitting.";

export const REPORT_SYSTEM =
  "You write City of Pinecrest planning staff reports in Markdown. Use exactly these sections as H2 headings after an H1 title: Summary, Project Description, Site & Zoning, Analysis of Checks (a table), Public Notice, Recommendation, Conditions.";

export function reportPrompt(app: Application): string {
  return [
    `Write the staff report for application ${app.id}.`,
    `Permit type: ${app.permitType}; address: ${app.address}; zoning ${app.zoning}; applicant ${app.applicant.name}.`,
    `Description: ${app.projectDescription}`,
    `Fields: ${JSON.stringify(app.fields)}`,
    `Review: ${JSON.stringify(app.review ?? null)}`,
  ].join("\n");
}

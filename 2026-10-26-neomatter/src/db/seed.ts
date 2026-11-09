import { db, lawyers, playbookClauses, matters, requests } from "./index";
import { intakeRequest } from "@/lib/triage";
import type { IntakeBody } from "@/lib/schemas";

const now = Date.now();

const LAWYERS = [
  { id: "law_priya", name: "Priya Shah", email: "priya@example.com", practiceAreas: ["commercial", "privacy"], isDefault: 1 },
  { id: "law_marcus", name: "Marcus Lee", email: "marcus@example.com", practiceAreas: ["employment", "general"], isDefault: 0 },
  { id: "law_dana", name: "Dana Ortiz", email: "dana@example.com", practiceAreas: ["corporate"], isDefault: 0 },
];

const c = (id: string, practiceArea: string, title: string, standardPosition: string, fallbackPosition: string, walkAway: string, approver: string) =>
  ({ id, practiceArea, title, standardPosition, fallbackPosition, walkAway, approver, createdAt: now, updatedAt: now });

const CLAUSES = [
  c("PB-LIAB-01", "commercial", "Limitation of liability cap", "Mutual cap at 12 months of fees paid; no unlimited liability.", "Cap at 24 months of fees; super-cap for data breach up to 2x fees.", "Any unlimited liability for the company.", "General Counsel"),
  c("PB-INDEM-01", "commercial", "Indemnification", "Indemnity limited to third-party IP infringement claims, subject to the liability cap.", "Add third-party bodily injury and confidentiality breach claims.", "Uncapped or first-party indemnity.", "General Counsel"),
  c("PB-LAW-01", "commercial", "Governing law and venue", "Delaware law, courts of Delaware.", "New York or England and Wales law.", "Counterparty home jurisdiction with exclusive foreign courts.", "Legal Director"),
  c("PB-PAY-01", "commercial", "Payment terms", "Net 30 from invoice receipt.", "Net 45; Net 60 for strategic customers with VP Finance approval.", "Net 90 or longer.", "VP Finance"),
  c("PB-RENEW-01", "commercial", "Auto-renewal", "No auto-renewal; renewal by written agreement. If unavoidable, 60 days non-renewal notice.", "Auto-renew for 12 months with 30 days notice and reminder.", "Auto-renew with no termination right or evergreen terms.", "Legal Director"),
  c("PB-TERM-01", "commercial", "Termination for convenience", "Either party may terminate for convenience on 30 days notice.", "90 days notice after the initial term.", "No termination right for the company.", "Legal Director"),
  c("PB-CONF-01", "commercial", "Confidentiality term and perpetual obligations", "Confidentiality obligations survive 3 years; trade secrets as long as they remain secret. No perpetual terms.", "Up to 5 years.", "Perpetual confidentiality on all information.", "Legal Director"),
  c("PB-DPA-01", "privacy", "Data processing addendum required", "A DPA is required whenever personal data (GDPR) is processed on our behalf.", "Accept the counterparty DPA if it contains SCCs and audit rights.", "Processing personal data without any DPA.", "Privacy Counsel"),
  c("PB-SUBPROC-01", "privacy", "Sub-processor notice", "30 days prior notice of new sub-processors with a right to object.", "14 days notice with right to terminate.", "No notice of sub-processors.", "Privacy Counsel"),
  c("PB-NONCOMP-01", "employment", "Non-compete", "No non-competes; use non-solicitation of 12 months instead.", "Non-compete for senior executives, 6 months, where lawful.", "Non-compete for non-executive employees.", "Head of People and GC"),
  c("PB-OFFER-01", "employment", "Offer letter approvals", "Offer letters use the standard template; deviations in salary band or equity need approval.", "Sign-on bonus up to 10% of base with People approval.", "Guaranteed severance or non-standard termination terms.", "Head of People"),
  c("PB-BOARD-01", "corporate", "Board approval threshold", "Board approval required for transactions or stock issuances above $250k.", "CEO may approve up to $500k with later board ratification.", "Closing above threshold without board resolution.", "Corporate Secretary"),
];

const MSA = `MASTER SERVICES AGREEMENT between Acme Corp and Vendor Inc.
1. Term: perpetual, commencing on the Effective Date.
2. Fees. Customer pays Net 30.
3. Liability. Vendor shall have unlimited liability for any claims arising under this Agreement.
4. Renewal. This Agreement shall auto-renew for successive one-year periods unless terminated.
5. Governing law: Delaware.`;

const SAMPLES: IntakeBody[] = [
  { channel: "email", requester_name: "Jordan Kim", requester_email: "jordan@example.com", subject: "Acme MSA review for Q4 deal", body: "Sales needs the Acme MSA reviewed today. They sent their paper and the deal closes this week. Please advise whether we can sign.", attachments: [{ name: "acme-msa.txt", text: MSA }] },
  { channel: "slack", requester_name: "Sam Rivera", subject: "Offer letter for new engineer", body: "Can you check the offer letter for the new employee? Candidate asked for a sign-on bonus.", attachments: [] },
  { channel: "teams", requester_name: "Lee Chen", subject: "GDPR question on analytics vendor", body: "We want to send personal data of EU users to a new analytics vendor. Do we need a DPA?", attachments: [] },
  { channel: "email", requester_name: "Alex Morgan", subject: "Board resolution for stock option grants", body: "Finance needs a board resolution drafted for the next batch of stock grants. Not urgent, due next month.", attachments: [] },
  { channel: "webhook", requester_name: "Taylor Brooks", subject: "Trademark question on new product name", body: "Marketing is considering a new product name. Any concerns we should know about?", attachments: [] },
];

export async function seed() {
  for (const l of LAWYERS) db.insert(lawyers).values(l).onConflictDoNothing().run();
  for (const cl of CLAUSES) db.insert(playbookClauses).values(cl).onConflictDoNothing().run();
  if (db.select().from(matters).all().length === 0) {
    for (let i = 0; i < SAMPLES.length; i++) {
      await intakeRequest(SAMPLES[i], now - (SAMPLES.length - i) * 3_600_000);
    }
  }
  return {
    lawyers: db.select().from(lawyers).all().length,
    clauses: db.select().from(playbookClauses).all().length,
    requests: db.select().from(requests).all().length,
    matters: db.select().from(matters).all().length,
  };
}

import type { ChatMessage, StudySynthesis } from "../src/lib/schemas";

export const synthesis: StudySynthesis = {
  headline: "h",
  mergedSteps: [
    { id: "m1", name: 'Receive "request" [email]; now', actorRole: "Sales", tools: ["Email"], manual: false, mentionedBy: 3 },
    { id: "m2", name: "Copy prices", actorRole: "Sales", tools: ["Excel"], manual: true, mentionedBy: 2 },
  ],
  edges: [{ from: "m1", to: "m2" }, { from: "m1", to: "ghost" }],
  exceptions: [{ condition: "Customer is new?", whatHappens: "credit check", mentionedBy: 1 }],
  painPoints: [],
  recommendations: [],
  openQuestions: [],
};

export const transcript: ChatMessage[] = [
  { role: "user", content: "It starts when a customer sends a request by email." },
  { role: "user", content: "First I check the CRM. Then I create a quote in Excel." },
  { role: "user", content: "I copy the prices by hand into the sheet and it is slow." },
  { role: "user", content: "I send it to Sales Ops by email for approval." },
  { role: "user", content: "If the customer is new I ask Finance for a credit check." },
  { role: "user", content: "Waiting for approvals is the slowest part, I retype data twice." },
  { role: "user", content: "Finally I export a PDF and send it." },
];


import { getAgency, getDocument, getProfile, listAgencies, listDocuments } from "./data";
import { scoreFit, templateRationale } from "./fit";
import { getLLM } from "./llm";
import type { DocContext } from "./llm/types";
import { splitPages } from "./pages";
import { applyDueDateChange } from "./planner";
import { buildRequirements, evaluateRequirement, extractKeyFields } from "./requirements";
import { findMatchingSignal, mergeSignal, normalizeTitle } from "./stages";
import { getById, readCollection, updateCollection, upsert } from "./store";
import type {
  Agency,
  Category,
  Change,
  DocKind,
  Document,
  Profile,
  Pursuit,
  Requirement,
  Signal,
  Source,
  Stage,
  Task,
} from "./types";
import { newId, quoteInText } from "./util";
import type { ExtractedSignal } from "./schemas";

export interface DocInput {
  title: string;
  agencyId?: string;
  agencyName?: string;
  kind: DocKind;
  date: string;
  text: string;
  parentDocumentId?: string;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function resolveAgency(agencyId?: string, agencyName?: string): Promise<Agency> {
  if (agencyId) {
    const a = await getAgency(agencyId);
    if (!a) throw new HttpError(400, `Unknown agencyId ${agencyId}`);
    return a;
  }
  const name = (agencyName ?? "").trim();
  const existing = (await listAgencies()).find((a) => a.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  const agency: Agency = { id: newId("ag"), name, region: "Unknown", type: "city" };
  await upsert("agencies", agency);
  return agency;
}

export async function ingestDocument(input: DocInput): Promise<Document> {
  const agency = await resolveAgency(input.agencyId, input.agencyName);
  if (input.kind === "addendum") {
    const parent = input.parentDocumentId ? await getDocument(input.parentDocumentId) : undefined;
    if (!parent || parent.kind !== "solicitation") throw new HttpError(400, "parentDocumentId must reference a solicitation document");
  }
  const pages = splitPages(input.text);
  if (!pages.length) throw new HttpError(400, "Document has no text");
  const doc: Document = {
    id: newId("doc"),
    agencyId: agency.id,
    title: input.title,
    kind: input.kind,
    date: input.date,
    parentDocumentId: input.parentDocumentId,
    pages,
    status: "ingested",
    signalIds: [],
    createdAt: new Date().toISOString(),
  };
  await upsert("documents", doc);
  return runExtraction(doc.id);
}

function docContext(doc: Document, agency: Agency): DocContext {
  return { title: doc.title, kind: doc.kind, agencyName: agency.name, date: doc.date };
}

/** Remove this document's sources from signals (deleting signals that lose their last source). */
async function detachDocumentSignals(docId: string): Promise<void> {
  await updateCollection<Signal>("signals", (signals) => {
    for (let i = signals.length - 1; i >= 0; i--) {
      const s = signals[i];
      if (!s.sources.some((x) => x.documentId === docId)) continue;
      s.sources = s.sources.filter((x) => x.documentId !== docId);
      if (!s.sources.length) signals.splice(i, 1);
    }
  });
}

export async function runExtraction(docId: string): Promise<Document> {
  const llm = getLLM();
  const doc = await getDocument(docId);
  if (!doc) throw new HttpError(404, "Document not found");
  const agency = await getAgency(doc.agencyId);
  if (!agency) throw new HttpError(400, "Agency missing");
  const profile = await getProfile();
  const ctx = docContext(doc, agency);
  try {
    await detachDocumentSignals(doc.id);
    let signalIds: string[] = [];
    let requirements = doc.requirements;
    let keyFields = doc.keyFields;
    let changes = doc.changes;
    if (doc.kind !== "addendum") {
      signalIds = await extractSignalsForDoc(doc, agency, profile, ctx);
    }
    if (doc.kind === "solicitation") {
      keyFields = extractKeyFields(doc.pages);
      const raws: { raw: Awaited<ReturnType<typeof llm.extractRequirements>>[number]; page: number; documentId: string }[] = [];
      for (const p of doc.pages) {
        for (const raw of await llm.extractRequirements({ page: p.n, text: p.text, doc: ctx })) {
          if (quoteInText(raw.quote, p.text)) raws.push({ raw, page: p.n, documentId: doc.id });
        }
      }
      requirements = buildRequirements(raws, profile, { engineersEstimate: keyFields.engineersEstimate?.amount });
      // keep requirements already contributed by addenda
      const kids = (await listDocuments()).filter((d) => d.parentDocumentId === doc.id && d.kind === "addendum");
      for (const k of kids) requirements.push(...(k.requirements ?? []));
    }
    if (doc.kind === "addendum") {
      changes = await extractChangesForDoc(doc, ctx);
    }
    await updateCollection<Document>("documents", (docs) => {
      const d = docs.find((x) => x.id === doc.id)!;
      Object.assign(d, { status: "extracted", error: undefined, signalIds, requirements, keyFields, changes });
    });
    if (doc.kind === "addendum") await applyAddendum(doc.id, ctx, profile);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await updateCollection<Document>("documents", (docs) => {
      const d = docs.find((x) => x.id === doc.id);
      if (d) Object.assign(d, { status: "failed", error: message });
    });
  }
  return (await getDocument(doc.id))!;
}

interface Candidate {
  title: string;
  category: Category;
  stage: Stage;
  estimatedValue?: number;
  valueText?: string;
  timing?: string;
  summary: string;
  confidence: number;
  sources: Source[];
}

function toCandidate(ex: ExtractedSignal, docId: string, page: number): Candidate {
  return {
    title: ex.projectTitle.trim(),
    category: ex.category,
    stage: ex.stage,
    estimatedValue: ex.estimatedValue ?? undefined,
    valueText: ex.valueText ?? undefined,
    timing: ex.timing ?? undefined,
    summary: ex.summary,
    confidence: ex.confidence,
    sources: [{ documentId: docId, page, quote: ex.evidenceQuote.trim() }],
  };
}

async function extractSignalsForDoc(doc: Document, agency: Agency, profile: Profile, ctx: DocContext): Promise<string[]> {
  const llm = getLLM();
  const byTitle = new Map<string, Candidate>();
  for (const p of doc.pages) {
    const extracted = await llm.extractSignals({ page: p.n, text: p.text, doc: ctx });
    for (const ex of extracted) {
      if (!quoteInText(ex.evidenceQuote, p.text)) continue; // drop hallucinated evidence
      const cand = toCandidate(ex, doc.id, p.n);
      const key = normalizeTitle(cand.title);
      const prev = byTitle.get(key);
      if (!prev) byTitle.set(key, cand);
      else byTitle.set(key, { ...mergeSignal({ ...prev }, cand), title: prev.title });
    }
  }
  const now = new Date().toISOString();
  const touched: string[] = [];
  await updateCollection<Signal>("signals", (signals) => {
    for (const cand of byTitle.values()) {
      const match = findMatchingSignal(signals, agency.id, cand.title);
      if (match) {
        Object.assign(match, mergeSignal(match, cand), { updatedAt: now });
        rescore(match, profile, agency);
        touched.push(match.id);
      } else {
        const s: Signal = {
          id: newId("sig"),
          agencyId: agency.id,
          projectTitle: cand.title,
          category: cand.category,
          stage: cand.stage,
          estimatedValue: cand.estimatedValue,
          valueText: cand.valueText,
          timing: cand.timing,
          summary: cand.summary,
          fitScore: 0,
          fitBreakdown: { category: 0, keywords: 0, region: 0, value: 0 },
          fitRationale: "",
          confidence: cand.confidence,
          sources: cand.sources,
          createdAt: now,
          updatedAt: now,
        };
        rescore(s, profile, agency);
        signals.push(s);
        touched.push(s.id);
      }
    }
  });
  // Rationales (LLM in live mode) are written after the deterministic scoring.
  for (const id of touched) {
    const s = await getById<Signal>("signals", id);
    if (!s) continue;
    const { matched } = fitFor(s, profile, agency);
    let rationale: string;
    try {
      rationale = await llm.writeFitRationale({
        profile,
        title: s.projectTitle,
        category: s.category,
        score: s.fitScore,
        breakdown: s.fitBreakdown,
        matchedKeywords: matched,
      });
    } catch {
      rationale = templateRationale(profile, s.fitBreakdown, matched, s.category);
    }
    await updateCollection<Signal>("signals", (all) => {
      const t = all.find((x) => x.id === id);
      if (t) t.fitRationale = rationale;
    });
  }
  return touched;
}

function fitFor(s: Signal, profile: Profile, agency: Agency) {
  const r = scoreFit(profile, {
    category: s.category,
    title: s.projectTitle,
    summary: s.summary,
    evidence: s.sources.map((x) => x.quote).join(" "),
    estimatedValue: s.estimatedValue,
    agencyRegion: agency.region,
  });
  return { ...r, matched: r.matchedKeywords };
}

/** Deterministic score + template rationale (mutates). */
export function rescore(s: Signal, profile: Profile, agency: Agency): void {
  const r = fitFor(s, profile, agency);
  s.fitScore = r.score;
  s.fitBreakdown = r.breakdown;
  s.fitRationale = templateRationale(profile, r.breakdown, r.matched, s.category);
}

export async function rescoreAllSignals(profile: Profile): Promise<void> {
  const agencies = new Map((await listAgencies()).map((a) => [a.id, a]));
  await updateCollection<Signal>("signals", (signals) => {
    for (const s of signals) {
      const a = agencies.get(s.agencyId);
      if (a) rescore(s, profile, a);
    }
  });
}

async function extractChangesForDoc(doc: Document, ctx: DocContext): Promise<Change[]> {
  const llm = getLLM();
  const parent = doc.parentDocumentId ? await getDocument(doc.parentDocumentId) : undefined;
  const out: Change[] = [];
  for (const p of doc.pages) {
    for (const c of await llm.extractChanges({ page: p.n, text: p.text, doc: ctx, parentTitle: parent?.title ?? "" })) {
      if (quoteInText(c.quote, p.text)) out.push({ ...c, page: p.n });
    }
  }
  return out;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Last `due_date` change carrying an ISO date, if any. */
export function pickDueDateChange(changes: Change[]): string | undefined {
  return [...changes].reverse().find((c) => c.field === "due_date" && c.after && ISO.test(c.after))?.after;
}

/** Addendum -> parent requirements re-run, linked pursuit due date / task shift / timeline events. */
async function applyAddendum(addendumId: string, ctx: DocContext, profile: Profile): Promise<void> {
  const llm = getLLM();
  const add = (await getDocument(addendumId))!;
  const parentId = add.parentDocumentId!;
  const parent = (await getDocument(parentId))!;
  // 1. requirements checklist including the addendum
  const raws: { raw: Awaited<ReturnType<typeof llm.extractRequirements>>[number]; page: number; documentId: string }[] = [];
  for (const p of add.pages) {
    for (const raw of await llm.extractRequirements({ page: p.n, text: p.text, doc: ctx })) {
      if (quoteInText(raw.quote, p.text)) raws.push({ raw, page: p.n, documentId: add.id });
    }
  }
  const estimate = parent.keyFields?.engineersEstimate?.amount;
  const addReqs = buildRequirements(raws, profile, { engineersEstimate: estimate });
  await updateCollection<Document>("documents", (docs) => {
    const a = docs.find((d) => d.id === add.id)!;
    a.requirements = addReqs;
    const p = docs.find((d) => d.id === parentId)!;
    const kept = (p.requirements ?? []).filter((r) => r.documentId !== add.id);
    p.requirements = [...kept, ...addReqs].map((r) => ({ ...r, ...evaluateRequirement(r, profile, { engineersEstimate: estimate }) }));
  });
  // 2. linked pursuit
  const changes = add.changes ?? [];
  const newDue = pickDueDateChange(changes);
  const signals = await readCollection<Signal>("signals");
  const shifts: { taskIds: string[]; old: string; next: string }[] = [];
  await updateCollection<Pursuit>("pursuits", (pursuits) => {
    const linked = pursuits.filter(
      (p) => p.documentId === parentId || (p.signalId && signals.find((s) => s.id === p.signalId)?.sources.some((x) => x.documentId === parentId)),
    );
    for (const pursuit of linked) {
      const now = new Date().toISOString();
      for (const c of changes) {
        pursuit.events.push({ id: newId("ev"), at: now, type: `addendum_${c.field}`, summary: c.summary, documentId: add.id, page: c.page });
      }
      if (newDue && newDue !== pursuit.dueDate) {
        const old = pursuit.dueDate;
        if (old) shifts.push({ taskIds: [...pursuit.taskIds], old, next: newDue });
        pursuit.dueDate = newDue;
        pursuit.events.push({
          id: newId("ev"),
          at: now,
          type: "due_date_changed",
          summary: `Bid due date ${old ?? "unset"} -> ${newDue}; open task dates recomputed.`,
          documentId: add.id,
        });
      }
    }
  });
  // (separate lock acquisition: the store mutex is not re-entrant)
  for (const sh of shifts) {
    await updateCollection<Task>("tasks", (all) => {
      const mine = all.filter((t) => sh.taskIds.includes(t.id));
      for (const s of applyDueDateChange(mine, sh.old, sh.next)) {
        const t = all.find((x) => x.id === s.id);
        if (t) t.dueDate = s.dueDate;
      }
    });
  }
}

export type { Requirement };

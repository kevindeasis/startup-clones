import { addMonths, addYears, daysBetween, iso, monthsBetween, parseISO } from "./dates";
import type { Destination } from "./destinations";
import type { ApplicationRow, DocumentRow, TravellerRow } from "./schema";
import type { DocType, PassportFields, RuleResult, Verdict, Verification } from "./types";

function norm(s: string | number | null | undefined): string {
  return String(s ?? "").toUpperCase().replace(/[^A-Z]/g, "");
}

function worst(a: Verdict, b: Verdict): Verdict {
  const rank = { ok: 0, warning: 1, fail: 2 } as const;
  return rank[a] >= rank[b] ? a : b;
}

export function passportChecks(p: PassportFields, departure: string, dest: Destination, label: string): RuleResult[] {
  const out: RuleResult[] = [];
  const dep = parseISO(departure);
  const exp = parseISO(p.expiryDate);
  const issued = parseISO(p.issueDate);
  const months = dest.rules.passportValidityMonthsAfterDeparture;
  if (!exp) {
    out.push({ code: "passport_validity", severity: "fail", message: `${label}: passport expiry date is missing or unreadable.` });
  } else if (dep && exp < addMonths(dep, months)) {
    out.push({
      code: "passport_validity", severity: "fail",
      message: `${label}: passport must be valid at least ${months} months after departure (expires ${p.expiryDate}, needs ${iso(addMonths(dep, months))} or later).`,
    });
  }
  if (issued && dep && issued < addYears(dep, -dest.rules.passportMaxAgeYears)) {
    out.push({
      code: "passport_validity", severity: "fail",
      message: `${label}: passport must have been issued within the last ${dest.rules.passportMaxAgeYears} years (issued ${p.issueDate}).`,
    });
  }
  if (issued && dep && issued > dep) {
    out.push({ code: "passport_issue_date", severity: "warning", message: `${label}: passport issue date is after departure; check the extracted date.` });
  }
  return out;
}

interface DocCtx {
  app: ApplicationRow;
  dest: Destination;
  passport: PassportFields | null;
}

/** Deterministic checks layered on top of the (LLM) verification. May upgrade the verdict. */
export function applyDocChecks(type: DocType, v: Verification, ctx: DocCtx): Verification {
  const issues = [...v.issues];
  let verdict: Verdict = v.verdict;
  const ex = v.extracted ?? {};
  const bump = (to: Verdict, msg: string) => { issues.push(msg); verdict = worst(verdict, to); };

  if (!v.matchesExpectedType) bump("fail", "Document does not look like the expected type.");

  // Traveller name vs passport
  const holder = norm(ex.holderName as string | null);
  if (ctx.passport && holder && type !== "passport_copy") {
    const sn = norm(ctx.passport.surname);
    const first = norm((ctx.passport.givenNames ?? "").split(/\s+/)[0]);
    if ((sn && !holder.includes(sn)) || (first && !holder.includes(first))) {
      bump("warning", `Name on document ("${ex.holderName}") does not match the passport name.`);
    }
  }

  const depDate = parseISO(ctx.app.departureDate);
  const retDate = parseISO(ctx.app.returnDate);

  const compare = (label: string, a: unknown, b: unknown, ad: Date | null, bd: Date | null) => {
    const x = parseISO(a as string);
    const y = parseISO(b as string);
    if (!x || !y || !ad || !bd) return;
    const gap = Math.max(Math.abs(daysBetween(x, ad)), Math.abs(daysBetween(y, bd)));
    if (gap > 2) bump("fail", `${label} dates differ from the travel dates by ${gap} days.`);
    else if (gap > 0) bump("warning", `${label} dates differ slightly from the travel dates (${gap} day).`);
  };

  if (type === "flight_itinerary") compare("Flight itinerary", ex.departureDate, ex.returnDate, depDate, retDate);
  if (type === "hotel_booking") {
    const ci = parseISO(ex.checkIn as string);
    const co = parseISO(ex.checkOut as string);
    if (ci && co && depDate && retDate) {
      // Must cover the stay; allow arrival-day mismatch of up to 1 day.
      const gap = Math.max(daysBetween(depDate, ci), daysBetween(co, retDate), 0);
      if (gap > 2) bump("fail", `Hotel booking does not cover the full stay (gap of ${gap} days).`);
      else if (gap > 0) bump("warning", "Hotel booking is a day short of the full stay.");
    }
  }
  if (type === "bank_statement") {
    let months: number | null = typeof ex.coverageMonths === "number" ? ex.coverageMonths : null;
    const s = parseISO(ex.periodStart as string);
    const e = parseISO(ex.periodEnd as string);
    if (s && e) months = monthsBetween(s, e);
    const need = ctx.dest.rules.bankStatementMonths;
    if (months !== null && months < need - 0.1) {
      bump("fail", `Bank statement covers about ${months.toFixed(1)} months; ${need} required.`);
    }
  }
  if (type === "travel_insurance" && ctx.dest.rules.insuranceMinCoverEUR) {
    const cover = typeof ex.coverageEUR === "number" ? ex.coverageEUR : Number(ex.coverageEUR);
    const min = ctx.dest.rules.insuranceMinCoverEUR;
    if (Number.isFinite(cover) && cover < min) {
      bump("fail", `Insurance cover EUR ${cover.toLocaleString("en-US")} is below the EUR ${min.toLocaleString("en-US")} minimum.`);
    }
    const vf = parseISO(ex.validFrom as string);
    const vt = parseISO(ex.validTo as string);
    if (vf && vt && depDate && retDate && (vf > depDate || vt < retDate)) {
      bump("fail", "Insurance validity does not cover the whole trip.");
    }
  }
  return { ...v, issues, verdict };
}

export interface EffectiveDoc {
  doc: DocumentRow;
  verification: Verification;
}

export function computeRuleResults(
  app: ApplicationRow,
  dest: Destination,
  travellers: TravellerRow[],
  documents: DocumentRow[],
): { results: RuleResult[]; effective: Map<string, Verification> } {
  const results: RuleResult[] = [];
  const effective = new Map<string, Verification>();
  const byId = new Map(travellers.map((t) => [t.id, t]));

  for (const t of travellers) {
    results.push(...passportChecks(t.passport, app.departureDate, dest, `Traveller ${t.index}`));
  }

  for (const req of dest.docs) {
    if (req.type === "passport_copy") {
      if (travellers.length < app.travellerCount) {
        results.push({
          code: "missing_passport_copy", severity: "missing", docType: "passport_copy",
          message: `Upload the passport for ${app.travellerCount - travellers.length} more traveller(s).`,
        });
      }
      continue;
    }
    const docs = documents.filter((d) => d.type === req.type);
    if (req.scope === "shared") {
      if (docs.length === 0) {
        results.push({ code: `missing_${req.type}`, severity: "missing", docType: req.type, message: `Missing: ${req.label}.` });
      }
    } else {
      const missing: number[] = [];
      for (let i = 1; i <= app.travellerCount; i++) {
        const t = travellers.find((x) => x.index === i);
        if (!t || !docs.some((d) => d.travellerId === t.id)) missing.push(i);
      }
      if (missing.length) {
        results.push({
          code: `missing_${req.type}`, severity: "missing", docType: req.type,
          message: `Missing: ${req.label} for traveller${missing.length > 1 ? "s" : ""} ${missing.join(", ")}.`,
        });
      }
    }
    for (const d of docs) {
      const t = d.travellerId ? byId.get(d.travellerId) : undefined;
      const v = applyDocChecks(req.type, d.verification, { app, dest, passport: t?.passport ?? null });
      effective.set(d.id, v);
      const label = `${req.label}${t ? ` (traveller ${t.index})` : ""}`;
      if (v.verdict === "ok") {
        results.push({ code: `doc_${req.type}`, severity: "ok", docType: req.type, message: `${label}: looks good.` });
      } else {
        results.push({
          code: `doc_${req.type}`, severity: v.verdict, docType: req.type,
          message: `${label}: ${v.issues[0] ?? (v.verdict === "fail" ? "failed verification" : "needs attention")}`,
        });
      }
    }
  }
  return { results, effective };
}

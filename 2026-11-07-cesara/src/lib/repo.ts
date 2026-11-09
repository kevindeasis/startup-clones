import { nanoid } from "nanoid";
import Papa from "papaparse";
import { getDb } from "./db";
import { priceClaim } from "./pricing";
import { round2 } from "./format";
import {
  ClaimInputSchema,
  type ClaimInput,
  type ClaimRow,
  type ContractTerms,
} from "./types";

export interface ContractRecord {
  id: string;
  payer: string;
  name: string;
  source_text: string;
  terms: ContractTerms;
  created_at: string;
}

interface ContractDbRow {
  id: string;
  payer: string;
  name: string;
  source_text: string;
  terms_json: string;
  created_at: string;
}

function hydrate(r: ContractDbRow): ContractRecord {
  return { ...r, terms: JSON.parse(r.terms_json) as ContractTerms };
}

export function createContract(name: string, sourceText: string, terms: ContractTerms) {
  const id = nanoid(10);
  getDb()
    .prepare(
      "INSERT INTO contracts (id, payer, name, source_text, terms_json, created_at) VALUES (?,?,?,?,?,?)",
    )
    .run(id, terms.payer, name, sourceText, JSON.stringify(terms), new Date().toISOString());
  return id;
}

export function getContract(id: string): ContractRecord | null {
  const r = getDb().prepare("SELECT * FROM contracts WHERE id = ?").get(id) as
    | ContractDbRow
    | undefined;
  return r ? hydrate(r) : null;
}

export interface Summary {
  total: number;
  underpaid: number;
  overpaid: number;
  ok: number;
  no_rate_found: number;
  total_underpaid_amount: number;
  recovered_amount: number;
}

export function summarize(contractId: string): Summary {
  const rows = getDb()
    .prepare("SELECT flag, status, variance FROM claims WHERE contract_id = ?")
    .all(contractId) as { flag: string; status: string; variance: number | null }[];
  const s: Summary = {
    total: rows.length,
    underpaid: 0,
    overpaid: 0,
    ok: 0,
    no_rate_found: 0,
    total_underpaid_amount: 0,
    recovered_amount: 0,
  };
  for (const r of rows) {
    if (r.flag === "underpaid") {
      s.underpaid++;
      s.total_underpaid_amount += r.variance ?? 0;
      if (r.status === "recovered") s.recovered_amount += r.variance ?? 0;
    } else if (r.flag === "overpaid") s.overpaid++;
    else if (r.flag === "ok") s.ok++;
    else if (r.flag === "no_rate_found") s.no_rate_found++;
  }
  s.total_underpaid_amount = round2(s.total_underpaid_amount);
  s.recovered_amount = round2(s.recovered_amount);
  return s;
}

export function listContracts() {
  const rows = getDb().prepare("SELECT * FROM contracts ORDER BY created_at DESC").all() as ContractDbRow[];
  return rows.map((r) => {
    const c = hydrate(r);
    return {
      id: c.id,
      payer: c.payer,
      name: c.name,
      created_at: c.created_at,
      terms_count: c.terms.terms.length,
      ...summarize(c.id),
    };
  });
}

export function listClaims(contractId: string, flag?: string | null): ClaimRow[] {
  const db = getDb();
  if (flag && flag !== "all") {
    return db
      .prepare("SELECT * FROM claims WHERE contract_id = ? AND flag = ? ORDER BY claim_id")
      .all(contractId, flag) as ClaimRow[];
  }
  return db.prepare("SELECT * FROM claims WHERE contract_id = ? ORDER BY claim_id").all(contractId) as ClaimRow[];
}

export function getClaim(rowId: string): ClaimRow | null {
  return (getDb().prepare("SELECT * FROM claims WHERE id = ?").get(rowId) as ClaimRow | undefined) ?? null;
}

export function parseClaimsCsv(csv: string): { rows: ClaimInput[]; errors: string[] } {
  const parsed = Papa.parse<Record<string, string>>(csv.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
    transform: (v) => (typeof v === "string" ? v.trim() : v),
  });
  const rows: ClaimInput[] = [];
  const errors: string[] = [];
  parsed.data.forEach((raw, i) => {
    const num = (v: string | undefined) => (v === undefined || v === "" ? undefined : Number(String(v).replace(/[$,]/g, "")));
    let date = raw.service_date ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const d = new Date(date);
      if (!Number.isNaN(d.getTime())) date = d.toISOString().slice(0, 10);
    }
    const res = ClaimInputSchema.safeParse({
      claim_id: raw.claim_id,
      patient_ref: raw.patient_ref ?? "",
      service_date: date,
      code_type: (raw.code_type ?? "").toUpperCase(),
      code: raw.code,
      description: raw.description ?? "",
      units: num(raw.units) ?? 1,
      billed_charges: num(raw.billed_charges),
      paid_amount: num(raw.paid_amount),
    });
    if (res.success) rows.push(res.data);
    else errors.push(`Row ${i + 2}: ${res.error.issues.map((x) => `${x.path.join(".")} ${x.message}`).join("; ")}`);
  });
  return { rows, errors };
}

/** Prices every row and replaces the contract's claims. */
export function replaceClaims(contract: ContractRecord, inputs: ClaimInput[]): ClaimRow[] {
  const db = getDb();
  const now = new Date().toISOString();
  const out: ClaimRow[] = [];
  const ins = db.prepare(
    `INSERT INTO claims (id, contract_id, claim_id, patient_ref, service_date, code_type, code, description, units,
      billed_charges, paid_amount, expected_amount, variance, flag, reason, clause_ref, status, created_at)
     VALUES (@id,@contract_id,@claim_id,@patient_ref,@service_date,@code_type,@code,@description,@units,
      @billed_charges,@paid_amount,@expected_amount,@variance,@flag,@reason,@clause_ref,@status,@created_at)`,
  );
  db.transaction(() => {
    db.prepare("DELETE FROM claims WHERE contract_id = ?").run(contract.id);
    for (const c of inputs) {
      const p = priceClaim(c, contract.terms);
      const row: ClaimRow = {
        ...c,
        id: nanoid(10),
        contract_id: contract.id,
        expected_amount: p.expected,
        variance: p.variance,
        flag: p.flag,
        reason: p.reason,
        clause_ref: p.clause_ref,
        status: "open",
        created_at: now,
      };
      ins.run(row);
      out.push(row);
    }
  })();
  return out;
}

export function saveAppeal(claimRowId: string, letter: string) {
  const id = nanoid(10);
  getDb()
    .prepare("INSERT INTO appeals (id, claim_row_id, letter_text, created_at) VALUES (?,?,?,?)")
    .run(id, claimRowId, letter, new Date().toISOString());
  return id;
}

export function latestAppeal(claimRowId: string): string | null {
  const r = getDb()
    .prepare("SELECT letter_text FROM appeals WHERE claim_row_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(claimRowId) as { letter_text: string } | undefined;
  return r?.letter_text ?? null;
}

CREATE TABLE IF NOT EXISTS contracts (
  id TEXT PRIMARY KEY,
  payer TEXT,
  name TEXT,
  source_text TEXT,
  terms_json TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  claim_id TEXT,
  patient_ref TEXT,
  service_date TEXT,
  code_type TEXT,            -- 'DRG' | 'CPT' | 'REV'
  code TEXT,
  description TEXT,
  units REAL,
  billed_charges REAL,
  paid_amount REAL,
  expected_amount REAL,      -- NULL when no rate found
  variance REAL,             -- expected - paid
  flag TEXT,                 -- 'underpaid' | 'overpaid' | 'ok' | 'no_rate_found'
  reason TEXT,               -- human-readable explanation of the computation
  clause_ref TEXT,           -- id of the term used
  status TEXT,               -- 'open' | 'appealed' | 'recovered' | 'closed'
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_claims_contract ON claims(contract_id);

CREATE TABLE IF NOT EXISTS appeals (
  id TEXT PRIMARY KEY,
  claim_row_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  letter_text TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS practice (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL, phone TEXT, address TEXT,
  hours_json TEXT NOT NULL, parking TEXT, what_to_bring TEXT,
  accepted_payers_json TEXT, faq_json TEXT
);
CREATE TABLE IF NOT EXISTS providers (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('dentist','hygienist')), color TEXT
);
CREATE TABLE IF NOT EXISTS operatories (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS patients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL, last_name TEXT NOT NULL, dob TEXT NOT NULL,
  phone TEXT, email TEXT, preferred_hygienist_id INTEGER REFERENCES providers(id),
  notes TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  provider_id INTEGER NOT NULL REFERENCES providers(id),
  operatory_id INTEGER NOT NULL REFERENCES operatories(id),
  start_at TEXT NOT NULL, end_at TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('hygiene','exam','emergency','followup','consult')),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','cancelled','no_show')),
  source TEXT NOT NULL DEFAULT 'staff' CHECK (source IN ('staff','ai_inbound','ai_recall')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_appt_start ON appointments(start_at);
CREATE INDEX IF NOT EXISTS idx_appt_patient ON appointments(patient_id);
CREATE TABLE IF NOT EXISTS insurance_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  payer TEXT NOT NULL, member_id TEXT NOT NULL, group_no TEXT,
  status TEXT, plan_name TEXT, in_network INTEGER, annual_max REAL, remaining_max REAL,
  coverage_json TEXT, flags_json TEXT, verified_at TEXT
);
CREATE TABLE IF NOT EXISTS payer_directory (
  payer TEXT NOT NULL, member_id TEXT NOT NULL, dob TEXT NOT NULL,
  status TEXT NOT NULL, plan_name TEXT, in_network INTEGER, annual_max REAL, remaining_max REAL,
  coverage_json TEXT, notes TEXT,
  PRIMARY KEY (payer, member_id)
);
CREATE TABLE IF NOT EXISTS insurance_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id INTEGER, payer TEXT, member_id TEXT,
  eligible INTEGER, source TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL CHECK (channel IN ('inbound','recall')),
  patient_id INTEGER, started_at TEXT NOT NULL, ended_at TEXT, outcome TEXT,
  mode TEXT NOT NULL DEFAULT 'mock',
  messages_json TEXT NOT NULL DEFAULT '[]', tool_log_json TEXT NOT NULL DEFAULT '[]',
  state_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS recall_outreach (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id), conversation_id INTEGER,
  message TEXT NOT NULL, proposed_slots_json TEXT, sent_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','replied','booked','declined','snoozed'))
);
CREATE TABLE IF NOT EXISTS messages_taken (
  id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id INTEGER,
  patient_name TEXT, phone TEXT, summary TEXT, created_at TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0
);

-- Double-booking guard at the database layer (chair or provider overlap).
CREATE TRIGGER IF NOT EXISTS appt_no_overlap_insert
BEFORE INSERT ON appointments WHEN NEW.status = 'scheduled'
BEGIN
  SELECT RAISE(ABORT, 'operatory_conflict') WHERE EXISTS (
    SELECT 1 FROM appointments a WHERE a.status='scheduled' AND a.operatory_id=NEW.operatory_id
      AND a.start_at < NEW.end_at AND a.end_at > NEW.start_at);
  SELECT RAISE(ABORT, 'provider_conflict') WHERE EXISTS (
    SELECT 1 FROM appointments a WHERE a.status='scheduled' AND a.provider_id=NEW.provider_id
      AND a.start_at < NEW.end_at AND a.end_at > NEW.start_at);
END;
CREATE TRIGGER IF NOT EXISTS appt_no_overlap_update
BEFORE UPDATE ON appointments WHEN NEW.status = 'scheduled'
BEGIN
  SELECT RAISE(ABORT, 'operatory_conflict') WHERE EXISTS (
    SELECT 1 FROM appointments a WHERE a.id<>NEW.id AND a.status='scheduled' AND a.operatory_id=NEW.operatory_id
      AND a.start_at < NEW.end_at AND a.end_at > NEW.start_at);
  SELECT RAISE(ABORT, 'provider_conflict') WHERE EXISTS (
    SELECT 1 FROM appointments a WHERE a.id<>NEW.id AND a.status='scheduled' AND a.provider_id=NEW.provider_id
      AND a.start_at < NEW.end_at AND a.end_at > NEW.start_at);
END;

CREATE TABLE IF NOT EXISTS studies (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  goal TEXT NOT NULL,
  audience TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  study_id TEXT NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  text TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS interviews (
  id TEXT PRIMARY KEY,
  study_id TEXT NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  participant_name TEXT,
  persona TEXT,
  synthetic INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'in_progress',
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('assistant','user')),
  content TEXT NOT NULL,
  kind TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS buyer_models (
  id TEXT PRIMARY KEY,
  study_id TEXT NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  model_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_interview ON messages(interview_id);
CREATE INDEX IF NOT EXISTS idx_interviews_study ON interviews(study_id);

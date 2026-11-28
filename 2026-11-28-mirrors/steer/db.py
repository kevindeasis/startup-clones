"""sqlite3 schema + thin repository methods."""
import json
import os
import sqlite3
import threading
import uuid
from datetime import datetime, timezone

SCHEMA = """
CREATE TABLE IF NOT EXISTS agents(
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'shadow' CHECK (mode IN ('off','shadow','active')),
  system_prompt_hint TEXT DEFAULT '', created_at TEXT);
CREATE TABLE IF NOT EXISTS turns(
  trace_id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1, entry_point TEXT, user_id TEXT, user_segment TEXT,
  messages_json TEXT NOT NULL, terminal TEXT, final INTEGER DEFAULT 0,
  outcome_success INTEGER, outcome_note TEXT DEFAULT '', latency_ms INTEGER, created_at TEXT);
CREATE INDEX IF NOT EXISTS idx_turns_agent ON turns(agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_turns_conv ON turns(agent_id, conversation_id);
CREATE TABLE IF NOT EXISTS mistakes(
  id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, title TEXT, description TEXT,
  evidence_json TEXT, suggested_guidance TEXT, suggested_trigger_json TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS corrections(
  id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, title TEXT, guidance TEXT, trigger_json TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','previewed','active','paused')),
  holdout_pct INTEGER DEFAULT 0, version INTEGER DEFAULT 1, preview_json TEXT,
  created_at TEXT, activated_at TEXT);
CREATE TABLE IF NOT EXISTS deliveries(
  id INTEGER PRIMARY KEY AUTOINCREMENT, correction_id TEXT, trace_id TEXT, conversation_id TEXT,
  group_name TEXT, delivered INTEGER, mode TEXT, created_at TEXT);
CREATE INDEX IF NOT EXISTS idx_deliv_corr ON deliveries(correction_id);
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


class Database:
    def __init__(self, path: str = ":memory:"):
        if path != ":memory:":
            d = os.path.dirname(os.path.abspath(path))
            os.makedirs(d, exist_ok=True)
        self.path = path
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.lock = threading.RLock()
        with self.lock:
            self.conn.executescript(SCHEMA)
            self.conn.commit()

    # -- low level
    def q(self, sql, params=()):
        with self.lock:
            return [dict(r) for r in self.conn.execute(sql, params).fetchall()]

    def q1(self, sql, params=()):
        rows = self.q(sql, params)
        return rows[0] if rows else None

    def x(self, sql, params=()):
        with self.lock:
            cur = self.conn.execute(sql, params)
            self.conn.commit()
            return cur.lastrowid

    # -- agents
    def create_agent(self, name, mode="shadow", hint=""):
        aid = new_id("ag")
        self.x("INSERT INTO agents(id,name,mode,system_prompt_hint,created_at) VALUES(?,?,?,?,?)",
               (aid, name, mode, hint, now()))
        return self.get_agent(aid)

    def get_agent(self, aid):
        return self.q1("SELECT * FROM agents WHERE id=?", (aid,))

    def list_agents(self):
        return self.q("SELECT * FROM agents ORDER BY created_at DESC, rowid DESC")

    def patch_agent(self, aid, name=None, mode=None):
        if name is not None:
            self.x("UPDATE agents SET name=? WHERE id=?", (name, aid))
        if mode is not None:
            self.x("UPDATE agents SET mode=? WHERE id=?", (mode, aid))
        return self.get_agent(aid)

    # -- turns
    def upsert_turn(self, agent_id, trace: dict, final, terminal, outcome):
        """Upsert by trace_id; the highest revision wins. Returns 'queued' or 'stale'."""
        rev = int(trace.get("conversationRevision", 1))
        with self.lock:
            old = self.q1("SELECT revision FROM turns WHERE trace_id=?", (trace["id"],))
            if old and old["revision"] > rev:
                return "stale"
            succ = None if outcome is None else int(bool(outcome["success"]))
            note = "" if outcome is None else outcome.get("note", "")
            user = trace.get("user") or {}
            vals = (agent_id, trace["conversationId"], rev, trace.get("entryPoint"), user.get("id"),
                    user.get("segment"), json.dumps(trace["messages"]), terminal, int(bool(final)),
                    succ, note, trace.get("turnLatencyMs"), now(), trace["id"])
            if old:
                self.x("""UPDATE turns SET agent_id=?, conversation_id=?, revision=?, entry_point=?, user_id=?,
                    user_segment=?, messages_json=?, terminal=COALESCE(?,terminal), final=?,
                    outcome_success=COALESCE(?,outcome_success),
                    outcome_note=CASE WHEN ? IS NULL THEN outcome_note ELSE ? END,
                    latency_ms=?, created_at=created_at WHERE trace_id=?""",
                       (agent_id, trace["conversationId"], rev, trace.get("entryPoint"), user.get("id"),
                        user.get("segment"), json.dumps(trace["messages"]), terminal, int(bool(final)),
                        succ, succ, note, trace.get("turnLatencyMs"), trace["id"]))
            else:
                self.x("""INSERT INTO turns(agent_id,conversation_id,revision,entry_point,user_id,user_segment,
                    messages_json,terminal,final,outcome_success,outcome_note,latency_ms,created_at,trace_id)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", vals)
            return "queued"

    def get_turn(self, trace_id):
        return self.q1("SELECT * FROM turns WHERE trace_id=?", (trace_id,))

    def list_turns(self, agent_id, limit=100, conversation_id=None, failed_only=False, final_only=False,
                   newest_first=True):
        sql, p = "SELECT * FROM turns WHERE agent_id=?", [agent_id]
        if conversation_id:
            sql += " AND conversation_id=?"; p.append(conversation_id)
        if failed_only:
            sql += " AND outcome_success=0"
        if final_only:
            sql += " AND final=1"
        sql += " ORDER BY created_at %s, rowid %s LIMIT ?" % (("DESC", "DESC") if newest_first else ("ASC", "ASC"))
        p.append(limit)
        return self.q(sql, p)

    def set_outcome(self, trace_id, success, note=""):
        self.x("UPDATE turns SET outcome_success=?, outcome_note=? WHERE trace_id=?",
               (int(bool(success)), note, trace_id))
        return self.get_turn(trace_id)

    # -- mistakes
    def replace_mistakes(self, agent_id, mistakes):
        with self.lock:
            self.conn.execute("DELETE FROM mistakes WHERE agent_id=?", (agent_id,))
            for m in mistakes:
                m["id"] = new_id("mis")
                self.conn.execute(
                    "INSERT INTO mistakes(id,agent_id,title,description,evidence_json,suggested_guidance,"
                    "suggested_trigger_json,created_at) VALUES(?,?,?,?,?,?,?,?)",
                    (m["id"], agent_id, m["title"], m["description"], json.dumps(m["evidence"]),
                     m["suggested_guidance"], json.dumps(m["suggested_trigger"]), now()))
            self.conn.commit()
        return self.list_mistakes(agent_id)

    def list_mistakes(self, agent_id):
        out = []
        for r in self.q("SELECT * FROM mistakes WHERE agent_id=? ORDER BY rowid", (agent_id,)):
            out.append({"id": r["id"], "agent_id": agent_id, "title": r["title"], "description": r["description"],
                        "evidence": json.loads(r["evidence_json"]),
                        "suggested_guidance": r["suggested_guidance"],
                        "suggested_trigger": json.loads(r["suggested_trigger_json"]),
                        "created_at": r["created_at"]})
        return out

    # -- corrections
    @staticmethod
    def _corr(r):
        if r is None:
            return None
        r = dict(r)
        r["trigger"] = json.loads(r.pop("trigger_json"))
        pj = r.pop("preview_json")
        r["preview"] = json.loads(pj) if pj else None
        return r

    def create_correction(self, agent_id, title, guidance, trigger: dict):
        cid = new_id("cor")
        self.x("INSERT INTO corrections(id,agent_id,title,guidance,trigger_json,status,version,created_at) "
               "VALUES(?,?,?,?,?,'draft',1,?)", (cid, agent_id, title, guidance, json.dumps(trigger), now()))
        return self.get_correction(cid)

    def get_correction(self, cid):
        return self._corr(self.q1("SELECT * FROM corrections WHERE id=?", (cid,)))

    def list_corrections(self, agent_id, status=None):
        sql, p = "SELECT * FROM corrections WHERE agent_id=?", [agent_id]
        if status:
            sql += " AND status=?"; p.append(status)
        return [self._corr(r) for r in self.q(sql + " ORDER BY rowid", p)]

    def patch_correction(self, cid, title=None, guidance=None, trigger=None):
        c = self.get_correction(cid)
        status = "draft" if c["status"] == "previewed" else c["status"]
        self.x("UPDATE corrections SET title=?, guidance=?, trigger_json=?, version=version+1, preview_json=NULL,"
               " status=? WHERE id=?",
               (title if title is not None else c["title"], guidance if guidance is not None else c["guidance"],
                json.dumps(trigger if trigger is not None else c["trigger"]), status, cid))
        return self.get_correction(cid)

    def set_preview(self, cid, preview: dict):
        c = self.get_correction(cid)
        status = "previewed" if c["status"] in ("draft", "previewed") else c["status"]
        self.x("UPDATE corrections SET preview_json=?, status=? WHERE id=?", (json.dumps(preview), status, cid))
        return self.get_correction(cid)

    def set_status(self, cid, status, holdout_pct=None):
        if status == "active":
            self.x("UPDATE corrections SET status='active', holdout_pct=?, activated_at=? WHERE id=?",
                   (holdout_pct or 0, now(), cid))
        else:
            self.x("UPDATE corrections SET status=? WHERE id=?", (status, cid))
        return self.get_correction(cid)

    def delete_correction(self, cid):
        self.x("DELETE FROM corrections WHERE id=?", (cid,))

    # -- deliveries
    def add_delivery(self, correction_id, trace_id, conversation_id, group, delivered, mode):
        self.x("INSERT INTO deliveries(correction_id,trace_id,conversation_id,group_name,delivered,mode,created_at)"
               " VALUES(?,?,?,?,?,?,?)",
               (correction_id, trace_id, conversation_id, group, int(delivered), mode, now()))

    def list_deliveries(self, correction_id):
        return self.q("SELECT * FROM deliveries WHERE correction_id=? ORDER BY id", (correction_id,))


def turn_trace(row: dict) -> dict:
    """Rebuild a trace-shaped dict from a turns row (for trigger evaluation)."""
    return {"id": row["trace_id"], "conversationId": row["conversation_id"],
            "conversationRevision": row["revision"], "entryPoint": row["entry_point"],
            "user": {"id": row["user_id"], "segment": row["user_segment"]},
            "messages": json.loads(row["messages_json"]), "turnLatencyMs": row["latency_ms"]}

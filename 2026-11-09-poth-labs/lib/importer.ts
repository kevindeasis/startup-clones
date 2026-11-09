import Papa from "papaparse";
import type Database from "better-sqlite3";

const ID_KEYS = ["account_id", "external_id", "id"];
const NAME_KEYS = ["name", "company", "account_name", "account"];

function pick(row: Record<string, string>, keys: string[]): string | undefined {
  for (const k of keys) if (row[k] !== undefined && row[k] !== "") return row[k];
}

function ensureAccount(db: Database.Database, projectId: number, ext: string, name: string, attrs: Record<string, unknown> = {}): number {
  const found = db.prepare("SELECT id, attrs_json FROM accounts WHERE project_id=? AND external_id=?").get(projectId, ext) as { id: number; attrs_json: string } | undefined;
  if (found) {
    if (Object.keys(attrs).length) db.prepare("UPDATE accounts SET attrs_json=? WHERE id=?").run(JSON.stringify({ ...JSON.parse(found.attrs_json), ...attrs }), found.id);
    return found.id;
  }
  return Number(db.prepare("INSERT INTO accounts(project_id, external_id, name, attrs_json) VALUES(?,?,?,?)").run(projectId, ext, name, JSON.stringify(attrs)).lastInsertRowid);
}

/** CSV: either an accounts table (one row per account) or usage events (has an `event` column). */
export function importCsv(db: Database.Database, projectId: number, csv: string) {
  const parsed = Papa.parse<Record<string, string>>(csv.trim(), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase() });
  let accounts = 0, evidence = 0;
  const tx = db.transaction(() => {
    for (const row of parsed.data) {
      const ext = pick(row, ID_KEYS);
      if (!ext) continue;
      const name = pick(row, NAME_KEYS) ?? ext;
      const isEvent = "event" in row;
      const before = (db.prepare("SELECT COUNT(*) c FROM accounts WHERE project_id=?").get(projectId) as { c: number }).c;
      if (isEvent) {
        const aid = ensureAccount(db, projectId, ext, name);
        const rest = Object.entries(row).filter(([k]) => !ID_KEYS.includes(k)).map(([k, v]) => `${k}=${v}`).join(", ");
        db.prepare("INSERT INTO evidence(project_id, account_id, kind, text) VALUES(?,?,?,?)").run(projectId, aid, "usage", `${name} (${ext}) usage event: ${rest}`);
        evidence++;
      } else {
        const attrs: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(row)) if (!ID_KEYS.includes(k) && !NAME_KEYS.includes(k) && v !== "") attrs[k] = v;
        const aid = ensureAccount(db, projectId, ext, name, attrs);
        const rest = Object.entries(attrs).map(([k, v]) => `${k}=${v}`).join(", ");
        db.prepare("INSERT INTO evidence(project_id, account_id, kind, text) VALUES(?,?,?,?)").run(projectId, aid, "usage", `${name} (${ext}): ${rest}`);
        evidence++;
      }
      const after = (db.prepare("SELECT COUNT(*) c FROM accounts WHERE project_id=?").get(projectId) as { c: number }).c;
      accounts += after - before;
    }
  });
  tx();
  return { accounts, evidence, errors: parsed.errors.length };
}

/** Plain text: entries separated by blank lines; optional "[account_id] " prefix links an entry to an account. */
export function importText(db: Database.Database, projectId: number, text: string, kind: "ticket" | "call") {
  let evidence = 0;
  const tx = db.transaction(() => {
    for (const block of text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)) {
      const m = /^\[([^\]]+)\]\s*([\s\S]*)$/.exec(block);
      let accountId: number | null = null;
      let body = block;
      if (m) {
        const acc = db.prepare("SELECT id FROM accounts WHERE project_id=? AND external_id=?").get(projectId, m[1].trim()) as { id: number } | undefined;
        if (acc) { accountId = acc.id; body = m[2].trim(); }
      }
      db.prepare("INSERT INTO evidence(project_id, account_id, kind, text) VALUES(?,?,?,?)").run(projectId, accountId, kind, body);
      evidence++;
    }
  });
  tx();
  return { evidence };
}

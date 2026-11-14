import { getReadDb } from "./db";

export const ALLOWED_TABLES = ["events", "sites", "funnels", "goals"];
const FORBIDDEN =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH|DETACH|PRAGMA|REPLACE|VACUUM|REINDEX|TRIGGER|load_extension|sqlite_master|randomblob|readfile|writefile)\b/i;
const SITE_FILTER = /site_id\s*=\s*(:site|@site|\?)/i;
const CLAUSE_WORDS = new Set([
  "where", "group", "order", "limit", "join", "inner", "left", "right", "cross", "full", "outer", "natural",
  "on", "using", "union", "intersect", "except", "having", "window", "offset",
]);

export type Guarded = { ok: true; sql: string } | { ok: false; error: string };
export type QueryResult =
  | { ok: true; sql: string; columns: string[]; rows: Record<string, unknown>[]; rowCount: number; truncated: boolean }
  | { ok: false; error: string };

const stripComments = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
const stripLiterals = (sql: string) => sql.replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""');

function referencedTables(text: string): string[] {
  const tokens = text.match(/[A-Za-z_]\w*|[(),.]|\S/g) ?? [];
  const found: string[] = [];
  tokens.forEach((tok, i) => {
    if (!/^(from|join)$/i.test(tok)) return;
    let j = i + 1;
    for (;;) {
      if (tokens[j] === "(" || tokens[j] === undefined) break;
      found.push(tokens[j].toLowerCase() + (tokens[j + 1] === "." ? "." : ""));
      j++;
      if (/^as$/i.test(tokens[j] ?? "")) j += 2;
      else if (/^[A-Za-z_]\w*$/.test(tokens[j] ?? "") && !CLAUSE_WORDS.has(tokens[j].toLowerCase())) j++;
      if (tokens[j] !== ",") break;
      j++;
    }
  });
  return found;
}

function cteNames(text: string): string[] {
  const names: string[] = [];
  const re = /([A-Za-z_]\w*)\s*(?:\([^)]*\))?\s+as\s*(?:not\s+)?(?:materialized\s*)?\(/gi;
  for (const m of text.matchAll(re)) names.push(m[1].toLowerCase());
  return names;
}

/** Validates an analyst query and returns the SQL that will actually run (site filter bound as :site, LIMIT added). */
export function guardSql(input: string): Guarded {
  const noComments = stripComments(input).trim().replace(/;+\s*$/, "").trim();
  if (!noComments) return { ok: false, error: "Empty query." };
  const text = stripLiterals(noComments);
  if (text.includes(";")) return { ok: false, error: "Only a single statement is allowed." };
  if (!/^(select|with)\b/i.test(text)) return { ok: false, error: "Query must start with SELECT or WITH." };
  const bad = text.match(FORBIDDEN);
  if (bad) return { ok: false, error: `Forbidden keyword: ${bad[1].toUpperCase()}. Only read-only SELECT queries are allowed.` };

  const allowed = new Set([...ALLOWED_TABLES, ...cteNames(text)]);
  for (const table of referencedTables(text)) {
    if (!allowed.has(table)) {
      return { ok: false, error: `Table "${table.replace(/\.$/, "")}" is not allowed. Allowed tables: ${ALLOWED_TABLES.join(", ")}.` };
    }
  }
  if (!SITE_FILTER.test(text)) {
    return { ok: false, error: "Query must filter on the site with `site_id = :site` (the site id is bound for you)." };
  }
  let sql = noComments.replace(/(site_id\s*=\s*)(@site|\?)/gi, "$1:site");
  if (/\?/.test(stripLiterals(sql))) return { ok: false, error: "Only the :site parameter is supported." };
  if (!/\blimit\b/i.test(text)) sql += " LIMIT 200";
  return { ok: true, sql };
}

/** The single path every analyst query (LLM or mock) takes: guard, then run on the read-only connection. */
export function runReadOnlySql(siteId: string, input: string): QueryResult {
  const guarded = guardSql(input);
  if (!guarded.ok) return guarded;
  try {
    const stmt = getReadDb().prepare(guarded.sql);
    const columns = stmt.columns().map((c) => c.name);
    const all = stmt.all({ site: siteId }) as Record<string, unknown>[];
    const rows = all.slice(0, 200);
    return { ok: true, sql: guarded.sql, columns, rows, rowCount: all.length, truncated: all.length > rows.length };
  } catch (e) {
    return { ok: false, error: `SQL error: ${(e as Error).message}` };
  }
}

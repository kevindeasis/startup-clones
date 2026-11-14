import { describe, expect, it } from "vitest";
import { guardSql } from "../src/lib/sql-guard";

const ok = "SELECT path, COUNT(*) AS n FROM events WHERE site_id = :site GROUP BY path";

describe("guardSql", () => {
  it("accepts a valid SELECT with a site filter and appends LIMIT 200", () => {
    const g = guardSql(ok);
    expect(g).toEqual({ ok: true, sql: `${ok} LIMIT 200` });
  });

  it("keeps an existing LIMIT and strips a trailing semicolon and comments", () => {
    const g = guardSql(`-- hi\nSELECT 1 FROM events WHERE site_id = :site /* x */ LIMIT 5;`);
    expect(g.ok && g.sql).toContain("LIMIT 5");
    expect(g.ok && g.sql.match(/LIMIT/gi)).toHaveLength(1);
  });

  it("normalises '= ?' and '= @site' to :site", () => {
    expect(guardSql("SELECT 1 FROM events WHERE site_id = ?")).toMatchObject({ ok: true, sql: expect.stringContaining("site_id = :site") });
    expect(guardSql("SELECT 1 FROM events WHERE site_id = @site")).toMatchObject({ ok: true, sql: expect.stringContaining("site_id = :site") });
  });

  it.each([
    ["INSERT", "INSERT INTO events (site_id) VALUES ('x')"],
    ["DROP", "DROP TABLE events"],
    ["PRAGMA", "PRAGMA table_info(events)"],
    ["ATTACH", "ATTACH DATABASE 'x.db' AS x"],
    ["DELETE inside SELECT text", "SELECT 1 FROM events WHERE site_id = :site AND name = (DELETE FROM events)"],
  ])("rejects %s", (_label, sql) => {
    expect(guardSql(sql).ok).toBe(false);
  });

  it("rejects multiple statements", () => {
    const g = guardSql(`${ok}; SELECT 1 FROM events WHERE site_id = :site`);
    expect(g).toMatchObject({ ok: false, error: expect.stringContaining("single statement") });
  });

  it("rejects queries without a site filter", () => {
    expect(guardSql("SELECT COUNT(*) FROM events")).toMatchObject({ ok: false, error: expect.stringContaining("site_id = :site") });
  });

  it("rejects unknown tables, including via JOIN and comma joins", () => {
    expect(guardSql("SELECT * FROM questions WHERE site_id = :site")).toMatchObject({ ok: false, error: expect.stringContaining("not allowed") });
    expect(guardSql("SELECT * FROM events e JOIN insights i ON 1 WHERE e.site_id = :site").ok).toBe(false);
    expect(guardSql("SELECT * FROM events, insights WHERE events.site_id = :site").ok).toBe(false);
  });

  it("rejects sqlite_master", () => {
    expect(guardSql("SELECT name FROM sqlite_master WHERE site_id = :site").ok).toBe(false);
  });

  it("allows CTE names and subqueries over allowed tables", () => {
    const sql = "WITH t AS (SELECT session_id FROM events WHERE site_id = :site) SELECT COUNT(*) FROM t WHERE session_id IN (SELECT session_id FROM events WHERE site_id = :site)";
    expect(guardSql(sql).ok).toBe(true);
  });

  it("ignores forbidden words inside string literals", () => {
    expect(guardSql("SELECT 1 FROM events WHERE site_id = :site AND name = 'create'").ok).toBe(true);
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Points the app at a fresh temp SQLite file; call before importing any module that touches the db. */
export function withTempDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hutch-test-"));
  process.env.DATABASE_PATH = path.join(dir, "test.db");
  return dir;
}

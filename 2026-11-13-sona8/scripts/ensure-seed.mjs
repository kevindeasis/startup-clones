// Runs the seed only when the database file does not exist yet (predev / prestart).
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const dbPath = path.resolve(process.env.DATABASE_PATH ?? "./data/worktalk.db");
if (!existsSync(dbPath)) {
  const r = spawnSync("npx", ["tsx", "scripts/seed.ts"], { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

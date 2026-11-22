import fs from "node:fs";
import path from "node:path";
import { analyze } from "../src/lib/analyze";
import { parseCsv } from "../src/lib/csv";
import { computeHealth } from "../src/lib/health";
import { mode } from "../src/lib/llm";
import { createKickoffProject } from "../src/lib/projects";
import { ingestSignal } from "../src/lib/radar";
import { emptyDb, newId, readDb, writeDb } from "../src/lib/store";
import type { Account, DB, Invoice, Note, Ticket, UsageWeek } from "../src/lib/types";
import { addDays, daysBetween, today } from "../src/lib/util";

const SEED = path.resolve("data/seed");
const ANCHOR = "2026-11-22"; // the day the seed files were written
const shift = Math.floor(daysBetween(ANCHOR, today()) / 7) * 7; // whole weeks keep Mondays aligned
const sh = (d: string) => addDays(d, shift);
const json = <T>(f: string): T => JSON.parse(fs.readFileSync(path.join(SEED, f), "utf8")) as T;

async function main() {
  const db: DB = emptyDb();
  db.accounts = json<Account[]>("accounts.json").map((a) => ({ ...a, contractStart: sh(a.contractStart), renewalDate: sh(a.renewalDate) }));
  for (const a of db.accounts) {
    const rows = parseCsv(fs.readFileSync(path.join(SEED, "usage", `${a.id}.csv`), "utf8"));
    for (const r of rows) {
      db.usage.push({ accountId: a.id, weekStart: sh(r.week_start), activeUsers: +r.active_users, meteredUnits: +r.metered_units, ticketsOpened: +r.tickets_opened } satisfies UsageWeek);
    }
  }
  db.tickets = json<Ticket[]>("tickets.json").map((t) => ({ ...t, openedAt: sh(t.openedAt), ...(t.closedAt ? { closedAt: sh(t.closedAt) } : {}) }));
  db.invoices = json<Invoice[]>("invoices.json").map((i) => ({ ...i, issuedAt: sh(i.issuedAt), dueAt: sh(i.dueAt), ...(i.paidAt ? { paidAt: sh(i.paidAt) } : {}) }));
  db.notes = json<Omit<Note, "id">[]>("notes.json").map((n) => ({ ...n, id: newId("note"), at: sh(n.at) }));
  writeDb(db); // fresh start (replaces any previous db.json)

  // onboarding projects from the bundled transcripts
  for (const a of db.accounts.filter((x) => x.stage === "onboarding")) {
    const f = path.join(SEED, "transcripts", `${a.id}.txt`);
    if (fs.existsSync(f)) await createKickoffProject(a.id, fs.readFileSync(f, "utf8"), { at: sh(addDays(ANCHOR, -30)), sourceTitle: "Kickoff call" });
  }

  // radar articles
  for (const r of json<{ title: string; text: string; source: string; url?: string; publishedAt: string }[]>("radar.json")) {
    await ingestSignal({ ...r, publishedAt: sh(r.publishedAt) });
  }

  // back-fill a 5-point health trend (weekly snapshots) from the data as it stood then
  const cur = readDb();
  const now = today();
  for (const a of cur.accounts) {
    for (let k = 5; k >= 1; k--) {
      const at = addDays(now, -7 * k);
      const h = computeHealth({
        account: a, now: at,
        usage: cur.usage.filter((u) => u.accountId === a.id), tickets: cur.tickets.filter((t) => t.accountId === a.id && t.openedAt <= at && (!t.closedAt || t.closedAt > at)),
        invoices: cur.invoices.filter((i) => i.accountId === a.id && i.issuedAt <= at && !(i.paidAt && i.paidAt > at) ),
        notes: cur.notes.filter((n) => n.accountId === a.id && n.at <= at),
      });
      cur.snapshots.push({ accountId: a.id, at, score: h.score });
    }
  }
  writeDb(cur);

  const { analyzed, newActions } = await analyze();
  const fin = readDb();
  console.log(`seeded (${mode()} mode): ${fin.accounts.length} accounts, ${fin.usage.length} usage weeks, ${fin.tickets.length} tickets, ${fin.invoices.length} invoices, ${fin.notes.length} notes, ${fin.projects.length} projects, ${fin.tasks.length} tasks, ${fin.signals.length} signals (${fin.signals.filter((s) => s.relevant).length} relevant)`);
  console.log(`analyzed ${analyzed} accounts, ${newActions.length} new actions from rules; ${fin.actions.length} actions total`);
  const byType = new Map<string, number>();
  for (const a of fin.actions) byType.set(`${a.type}${a.type === "usage_drop" ? `/${a.play}` : ""}`, (byType.get(`${a.type}${a.type === "usage_drop" ? `/${a.play}` : ""}`) ?? 0) + 1);
  console.log("actions:", [...byType].map(([k, v]) => `${k}=${v}`).join(", "));
  for (const a of fin.accounts) console.log(`  ${a.name.padEnd(26)} health ${a.health?.score} ${a.health?.band}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

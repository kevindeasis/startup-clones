/** Smoke test against a running mock-mode server: `MOCK_LLM=1 npm run dev` then `npm test`. */
const B = process.env.ROMA_API_URL || "http://localhost:3000";
const j = async (p: string, body?: unknown, method?: string) => {
  const r = await fetch(B + p, { method: method ?? (body ? "POST" : "GET"), headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return r.json() as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
};
let fails = 0;
const ok = (name: string, c: boolean) => { console.log(`${c ? "PASS" : "FAIL"} ${name}`); if (!c) fails++; };

async function main() {
const ctx = await j("/api/context");
ok("seeded Tasks and Notes", ["Tasks", "Notes"].every((n) => ctx.lists.some((l: any) => l.name === n))); // eslint-disable-line @typescript-eslint/no-explicit-any
const r = await j("/api/operator", { message: "call the dentist tomorrow, buy milk on friday, and what is the capital of Peru?" });
ok("operator created 2 tasks", r.createdItems.length === 2 && /^Call/.test(r.createdItems[0].title) && /^Buy/.test(r.createdItems[1].title));
const e = await j("/api/operator", { message: "email bob@example.com that the report is late" });
ok("email creates pending approval", e.approvals[0]?.kind === "send_email" && e.approvals[0].status === "pending");
const before = (await j("/api/outbox")).outbox.length;
await j(`/api/approvals/${e.approvals[0].id}/approve`, {});
ok("approve moves to outbox", (await j("/api/outbox")).outbox.length === before + 1);
const l = await j("/api/lists", { name: "Reading " + Date.now(), kind: "custom", fields: [{ name: "author", type: "text" }] });
const it = await j("/api/items", { title: "Read Dune", listId: l.id, fields: { author: "Frank Herbert" } });
ok("custom field round-trips", (await j(`/api/items/${it.id}`)).fields.author === "Frank Herbert");
await j(`/api/items/${it.id}`, undefined, "DELETE");
ok("soft delete", (await j(`/api/items?listId=${l.id}`)).items.length === 0 && (await j(`/api/items?listId=${l.id}&includeDeleted=1`)).items[0].deletedAt);
await j(`/api/items/${it.id}/restore`, {});
ok("restore", (await j(`/api/items?listId=${l.id}`)).items.length === 1);
const a = await j("/api/automations", { name: "Water plants", instruction: "create a task water the plants", cron: "0 8 * * *", enabled: false });
const run = await j(`/api/automations/${a.id}/run`, {});
ok("automation run creates task", run.createdItemIds.length === 1 && (await j(`/api/automations/${a.id}/runs`)).runs.length === 1);
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

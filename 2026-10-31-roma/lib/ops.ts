import { and, desc, eq, gt, isNull, isNotNull, like, or, sql, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "./db";
import { normalizeDate, normalizeTime, todayISO } from "./dates";

const { lists, items, approvals, outbox } = schema;

export type FieldDef = { name: string; type?: string };
export type ItemInput = {
  title: string; kind?: "task" | "note"; listId?: string; body?: string;
  dueDate?: string | null; dueTime?: string | null; fields?: Record<string, unknown>;
};
export type ItemUpdate = {
  id: string; title?: string; body?: string; checked?: boolean;
  dueDate?: string | null; dueTime?: string | null; listId?: string; fields?: Record<string, unknown>;
};

const now = () => new Date().toISOString();
const parse = <T,>(s: string | null | undefined, d: T): T => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

export function serializeItem(r: typeof items.$inferSelect) {
  const { fieldsJson, ...rest } = r;
  return { ...rest, fields: parse<Record<string, unknown>>(fieldsJson, {}) };
}
export function serializeList(r: typeof lists.$inferSelect) {
  const { fieldsJson, ...rest } = r;
  return { ...rest, fields: parse<FieldDef[]>(fieldsJson, []) };
}

// ---------- lists ----------
export function getLists() { return getDb().select().from(lists).orderBy(lists.createdAt).all().map(serializeList); }
export function getList(id: string) {
  const r = getDb().select().from(lists).where(eq(lists.id, id)).get();
  return r ? serializeList(r) : null;
}
export function defaultList(kind: "tasks" | "notes") {
  const r = getDb().select().from(lists).where(eq(lists.kind, kind)).orderBy(lists.createdAt).get();
  if (r) return r.id;
  const id = nanoid(10);
  getDb().insert(lists).values({ id, name: kind === "tasks" ? "Tasks" : "Notes", kind, createdAt: now() }).run();
  return id;
}
export function createList(input: { name: string; kind?: "custom" | "tasks" | "notes"; fields?: FieldDef[] }) {
  const id = nanoid(10);
  getDb().insert(lists).values({
    id, name: input.name, kind: input.kind ?? "custom",
    fieldsJson: input.fields ? JSON.stringify(input.fields) : null, createdAt: now(),
  }).run();
  return getList(id)!;
}
export function updateList(id: string, patch: { name?: string; fields?: FieldDef[] }) {
  const set: Partial<typeof lists.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.fields !== undefined) set.fieldsJson = JSON.stringify(patch.fields);
  if (Object.keys(set).length) getDb().update(lists).set(set).where(eq(lists.id, id)).run();
  return getList(id);
}
export function deleteList(id: string) {
  const l = getList(id);
  if (!l || l.kind !== "custom") return false;
  // move items to trash (soft-delete) then remove list
  getDb().update(items).set({ deletedAt: now() }).where(and(eq(items.listId, id), isNull(items.deletedAt))).run();
  const tasks = defaultList("tasks");
  getDb().update(items).set({ listId: tasks }).where(eq(items.listId, id)).run();
  getDb().delete(lists).where(eq(lists.id, id)).run();
  return true;
}

// ---------- items ----------
export function getItem(id: string) {
  const r = getDb().select().from(items).where(eq(items.id, id)).get();
  return r ? serializeItem(r) : null;
}
export function listItems(opts: { listId?: string; q?: string; changedSince?: string; includeDeleted?: boolean; onlyDeleted?: boolean } = {}) {
  const conds = [];
  if (opts.onlyDeleted) conds.push(isNotNull(items.deletedAt));
  else if (!opts.includeDeleted) conds.push(isNull(items.deletedAt));
  if (opts.listId) conds.push(eq(items.listId, opts.listId));
  if (opts.changedSince) conds.push(gt(items.updatedAt, opts.changedSince));
  if (opts.q) {
    const p = `%${opts.q}%`;
    conds.push(or(like(items.title, p), like(items.body, p))!);
  }
  return getDb().select().from(items).where(conds.length ? and(...conds) : undefined)
    .orderBy(items.checked, sql`${items.dueDate} IS NULL`, items.dueDate, desc(items.createdAt)).all().map(serializeItem);
}
export function searchItems(q: string) { return listItems({ q }).slice(0, 25); }

export function createItems(inputs: ItemInput[]) {
  const db = getDb();
  const created: ReturnType<typeof serializeItem>[] = [];
  for (const i of inputs) {
    const kind = i.kind ?? (i.listId && getList(i.listId)?.kind === "notes" ? "note" : "task");
    const listId = i.listId && getList(i.listId) ? i.listId : defaultList(kind === "note" ? "notes" : "tasks");
    const id = nanoid(10);
    const t = now();
    db.insert(items).values({
      id, listId, title: i.title.trim(), body: i.body ?? "", kind, checked: false,
      dueDate: normalizeDate(i.dueDate), dueTime: normalizeTime(i.dueTime),
      fieldsJson: i.fields ? JSON.stringify(i.fields) : null, deletedAt: null, createdAt: t, updatedAt: t,
    }).run();
    created.push(getItem(id)!);
  }
  return created;
}

export function applyUpdates(updates: ItemUpdate[]) {
  const db = getDb();
  const out: ReturnType<typeof serializeItem>[] = [];
  for (const u of updates) {
    const cur = getItem(u.id);
    if (!cur) continue;
    const set: Partial<typeof items.$inferInsert> = { updatedAt: now() };
    if (u.title !== undefined) set.title = u.title;
    if (u.body !== undefined) set.body = u.body;
    if (u.checked !== undefined) set.checked = u.checked;
    if (u.dueDate !== undefined) set.dueDate = normalizeDate(u.dueDate);
    if (u.dueTime !== undefined) set.dueTime = normalizeTime(u.dueTime);
    if (u.listId !== undefined && getList(u.listId)) set.listId = u.listId;
    if (u.fields !== undefined) set.fieldsJson = JSON.stringify({ ...cur.fields, ...u.fields });
    db.update(items).set(set).where(eq(items.id, u.id)).run();
    out.push(getItem(u.id)!);
  }
  return out;
}
export function softDelete(ids: string[]) {
  if (!ids.length) return 0;
  const t = now();
  return getDb().update(items).set({ deletedAt: t, updatedAt: t }).where(and(inArray(items.id, ids), isNull(items.deletedAt))).run().changes;
}
export function restoreItem(id: string) {
  getDb().update(items).set({ deletedAt: null, updatedAt: now() }).where(eq(items.id, id)).run();
  return getItem(id);
}
/** Permanently purge items trashed more than 30 days ago. */
export function purgeOldTrash() {
  const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString();
  getDb().delete(items).where(and(isNotNull(items.deletedAt), sql`${items.deletedAt} < ${cutoff}`)).run();
}

// ---------- context ----------
export function getContext() {
  const today = todayISO();
  const ls = getLists();
  const live = listItems();
  return {
    today,
    lists: ls.map((l) => ({ ...l, openCount: live.filter((i) => i.listId === l.id && !i.checked).length, totalCount: live.filter((i) => i.listId === l.id).length })),
    dueToday: live.filter((i) => !i.checked && i.dueDate === today),
    overdue: live.filter((i) => !i.checked && i.dueDate && i.dueDate < today),
  };
}

// ---------- approvals ----------
export type ApprovalKind = "send_email" | "delete_items" | "bulk_update";
export function createApproval(kind: ApprovalKind, payload: unknown, messageId?: string) {
  const id = nanoid(10);
  getDb().insert(approvals).values({ id, kind, payloadJson: JSON.stringify(payload), status: "pending", messageId: messageId ?? null, createdAt: now(), resolvedAt: null }).run();
  return id;
}
export function serializeApproval(r: typeof approvals.$inferSelect) {
  const { payloadJson, ...rest } = r;
  return { ...rest, payload: parse<Record<string, unknown>>(payloadJson, {}) };
}
export function getApprovals(status?: string) {
  const q = getDb().select().from(approvals);
  const rows = status ? q.where(eq(approvals.status, status as "pending")).orderBy(desc(approvals.createdAt)).all()
    : q.orderBy(desc(approvals.createdAt)).all();
  return rows.map(serializeApproval);
}
export function getApproval(id: string) {
  const r = getDb().select().from(approvals).where(eq(approvals.id, id)).get();
  return r ? serializeApproval(r) : null;
}
export function resolveApproval(id: string, decision: "approved" | "rejected") {
  const a = getApproval(id);
  if (!a) return { error: "not_found" as const };
  if (a.status !== "pending") return { error: "already_resolved" as const, approval: a };
  const db = getDb();
  if (decision === "approved") {
    const p = a.payload as Record<string, unknown>;
    if (a.kind === "send_email") {
      db.insert(outbox).values({ id: nanoid(10), to: String(p.to), subject: String(p.subject), body: String(p.body), sentAt: now() }).run();
    } else if (a.kind === "delete_items") {
      softDelete((p.ids as string[]) ?? []);
    } else if (a.kind === "bulk_update") {
      applyUpdates((p.updates as ItemUpdate[]) ?? []);
    }
  }
  db.update(approvals).set({ status: decision, resolvedAt: now() }).where(eq(approvals.id, id)).run();
  return { approval: getApproval(id)! };
}
export function getOutbox() { return getDb().select().from(outbox).orderBy(desc(outbox.sentAt)).all(); }

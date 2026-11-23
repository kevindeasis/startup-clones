import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

export type CollectionName =
  | "profile"
  | "agencies"
  | "documents"
  | "signals"
  | "pursuits"
  | "tasks"
  | "notes"
  | "awards"
  | "contacts";

export function storeDir(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR || "./data/store");
}

function fileFor(name: CollectionName): string {
  return path.join(storeDir(), `${name}.json`);
}

// In-process mutex: serialises every read-modify-write.
let chain: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

async function readFile<T>(name: CollectionName, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(fileFor(name), "utf8");
    return JSON.parse(raw) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw e;
  }
}

async function writeFileAtomic(name: CollectionName, data: unknown): Promise<void> {
  await fs.mkdir(storeDir(), { recursive: true });
  const target = fileFor(name);
  const tmp = `${target}.${randomBytes(4).toString("hex")}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, target);
}

export async function readCollection<T>(name: CollectionName): Promise<T[]> {
  return readFile<T[]>(name, []);
}

export async function writeCollection<T>(name: CollectionName, items: T[]): Promise<void> {
  await withLock(() => writeFileAtomic(name, items));
}

/** Read-modify-write a collection under the mutex. The mutator may mutate in place or return a new array. */
export async function updateCollection<T, R = void>(
  name: CollectionName,
  mutator: (items: T[]) => R | Promise<R>,
): Promise<R> {
  return withLock(async () => {
    const items = await readFile<T[]>(name, []);
    const result = await mutator(items);
    await writeFileAtomic(name, items);
    return result;
  });
}

export async function getById<T extends { id: string }>(name: CollectionName, id: string): Promise<T | undefined> {
  return (await readCollection<T>(name)).find((x) => x.id === id);
}

export async function upsert<T extends { id: string }>(name: CollectionName, item: T): Promise<T> {
  await updateCollection<T>(name, (items) => {
    const i = items.findIndex((x) => x.id === item.id);
    if (i >= 0) items[i] = item;
    else items.push(item);
  });
  return item;
}

export async function readProfile<T>(): Promise<T | undefined> {
  return readFile<T | undefined>("profile", undefined);
}

export async function writeProfile(profile: unknown): Promise<void> {
  await withLock(() => writeFileAtomic("profile", profile));
}

export async function resetStore(): Promise<void> {
  await withLock(async () => {
    await fs.rm(storeDir(), { recursive: true, force: true });
    await fs.mkdir(storeDir(), { recursive: true });
  });
}

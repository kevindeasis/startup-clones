export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

export function setPath<T extends object>(obj: T, path: string, value: unknown): T {
  const keys = path.split(".");
  const root: Record<string, unknown> = { ...(obj as Record<string, unknown>) };
  let cur = root;
  for (let i = 0; i < keys.length - 1; i++) {
    const next = cur[keys[i]];
    const copy: Record<string, unknown> =
      next && typeof next === "object" ? { ...(next as Record<string, unknown>) } : {};
    cur[keys[i]] = copy;
    cur = copy;
  }
  const last = keys[keys.length - 1];
  if (value === undefined) delete cur[last];
  else cur[last] = value;
  return root as T;
}

export function isPresent(v: unknown): boolean {
  return v !== undefined && v !== null && v !== "" && !(typeof v === "number" && Number.isNaN(v));
}

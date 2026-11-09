export type Item = {
  id: string; listId: string; title: string; body: string; kind: "task" | "note"; checked: boolean;
  dueDate: string | null; dueTime: string | null; fields: Record<string, unknown>; deletedAt: string | null;
};
export type List = { id: string; name: string; kind: "tasks" | "notes" | "custom"; fields: { name: string; type?: string }[] };
export type Approval = { id: string; kind: string; status: "pending" | "approved" | "rejected"; payload: Record<string, unknown>; messageId: string | null };
export type Msg = { id: string; role: "user" | "assistant"; content: string; createdItems?: Item[]; approvals?: Approval[] };

export async function api<T = unknown>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(url, {
    method: init?.method ?? (init?.body ? "POST" : "GET"),
    headers: init?.body ? { "content-type": "application/json" } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || res.statusText);
  return data as T;
}

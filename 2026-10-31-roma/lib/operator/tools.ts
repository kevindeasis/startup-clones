import { z } from "zod";
import * as ops from "../ops";

export type ToolCtx = { createdItemIds: string[]; approvalIds: string[] };
export const newCtx = (): ToolCtx => ({ createdItemIds: [], approvalIds: [] });

const itemInput = z.object({
  title: z.string().describe("Verb-first, cleaned-up title"),
  kind: z.enum(["task", "note"]).default("task"),
  listId: z.string().optional().describe("List id; defaults to Tasks (or Notes for notes)"),
  body: z.string().optional(),
  dueDate: z.string().optional().describe("YYYY-MM-DD (a day, unless a time was stated)"),
  dueTime: z.string().optional().describe("HH:MM, only if the user stated a time"),
  fields: z.record(z.string(), z.unknown()).optional().describe("Custom list field values"),
});
const itemUpdate = z.object({
  id: z.string(),
  title: z.string().optional(), body: z.string().optional(), checked: z.boolean().optional(),
  dueDate: z.string().nullable().optional(), dueTime: z.string().nullable().optional(),
  listId: z.string().optional(), fields: z.record(z.string(), z.unknown()).optional(),
});

export async function webSearchImpl(query: string) {
  try {
    const { search, SafeSearchType } = await import("duck-duck-scrape");
    const r = await Promise.race([
      search(query, { safeSearch: SafeSearchType.MODERATE }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000)),
    ]);
    const results = r.results.slice(0, 5).map((x) => ({ title: x.title, url: x.url, snippet: x.rawDescription }));
    if (!results.length) return { results: [], message: "No results found." };
    return { results };
  } catch (e) {
    return { results: [], message: `Search unavailable (${e instanceof Error ? e.message : "error"}). Answer from your own knowledge and say so.` };
  }
}

/** Single source of truth for tool implementations, used by both real and mock operators. */
export function buildTools(ctx: ToolCtx) {
  return {
    get_context: {
      description: "Get the user's lists, counts, and items that are due today or overdue. Call this first when unsure.",
      schema: z.object({}),
      run: async () => ops.getContext(),
    },
    search: {
      description: "Keyword search over item titles and bodies.",
      schema: z.object({ query: z.string() }),
      run: async ({ query }: { query: string }) => ({ items: ops.searchItems(query) }),
    },
    create_items: {
      description: "Create tasks or notes. Titles are verb-first. Due date is a day unless a time is stated.",
      schema: z.object({ items: z.array(itemInput).min(1) }),
      run: async ({ items }: { items: z.infer<typeof itemInput>[] }) => {
        const created = ops.createItems(items);
        ctx.createdItemIds.push(...created.map((c) => c.id));
        return { created: created.map((c) => ({ id: c.id, title: c.title, listId: c.listId, dueDate: c.dueDate, dueTime: c.dueTime })) };
      },
    },
    update_items: {
      description: "Edit, check off, or move items. With 5 or more updates this creates an approval instead of applying.",
      schema: z.object({ updates: z.array(itemUpdate).min(1) }),
      run: async ({ updates }: { updates: z.infer<typeof itemUpdate>[] }) => {
        if (updates.length >= 5) {
          const id = ops.createApproval("bulk_update", { updates });
          ctx.approvalIds.push(id);
          return { pendingApprovalId: id, note: "Bulk change needs user approval." };
        }
        const done = ops.applyUpdates(updates as ops.ItemUpdate[]);
        return { updated: done.map((d) => ({ id: d.id, title: d.title })) };
      },
    },
    delete_items: {
      description: "Delete items. Never executes directly: always creates an approval card.",
      schema: z.object({ ids: z.array(z.string()).min(1) }),
      run: async ({ ids }: { ids: string[] }) => {
        const titles = ids.map((i) => ops.getItem(i)?.title ?? i);
        const id = ops.createApproval("delete_items", { ids, titles });
        ctx.approvalIds.push(id);
        return { pendingApprovalId: id, note: "Deletion needs user approval." };
      },
    },
    web_search: {
      description: "Search the web for current information. Returns the top 5 results.",
      schema: z.object({ query: z.string() }),
      run: async ({ query }: { query: string }) => webSearchImpl(query),
    },
    send_email: {
      description: "Send an email. Never executes directly: creates an approval card the user must approve.",
      schema: z.object({ to: z.string(), subject: z.string(), body: z.string() }),
      run: async (a: { to: string; subject: string; body: string }) => {
        const id = ops.createApproval("send_email", a);
        ctx.approvalIds.push(id);
        return { pendingApprovalId: id, note: "Email is awaiting user approval." };
      },
    },
  };
}
export type Tools = ReturnType<typeof buildTools>;

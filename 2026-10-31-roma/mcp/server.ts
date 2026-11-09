/**
 * Roma clone MCP server (stdio). Talks to the running app over its REST API (ROMA_API_URL).
 * Start the app first (`npm run dev`), then `npm run mcp`.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = (process.env.ROMA_API_URL || "http://localhost:3000").replace(/\/$/, "");

async function call(path: string, init?: { method?: string; body?: unknown }) {
  try {
    const res = await fetch(BASE + path, {
      method: init?.method ?? (init?.body ? "POST" : "GET"),
      headers: init?.body ? { "content-type": "application/json" } : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
    const text = await res.text();
    return { content: [{ type: "text" as const, text }], isError: !res.ok };
  } catch (e) {
    return { content: [{ type: "text" as const, text: `Cannot reach Roma at ${BASE}: ${e instanceof Error ? e.message : e}. Is the app running?` }], isError: true };
  }
}

const server = new McpServer({ name: "roma-clone", version: "0.1.0" });

server.registerTool("get_context", { description: "Lists, counts, and items due today or overdue. Call this first." }, () => call("/api/context"));

server.registerTool("list_lists", { description: "List all lists (id, name, kind, custom fields)." }, () => call("/api/lists"));

server.registerTool("list_items", {
  description: "List items, optionally filtered by list, text, or changed-since timestamp.",
  inputSchema: { listId: z.string().optional(), q: z.string().optional(), changedSince: z.string().optional(), includeDeleted: z.boolean().optional() },
}, ({ listId, q, changedSince, includeDeleted }) => {
  const p = new URLSearchParams();
  if (listId) p.set("listId", listId);
  if (q) p.set("q", q);
  if (changedSince) p.set("changedSince", changedSince);
  if (includeDeleted) p.set("includeDeleted", "1");
  return call(`/api/items?${p}`);
});

server.registerTool("get_item", { description: "Get one item by id.", inputSchema: { id: z.string() } }, ({ id }) => call(`/api/items/${encodeURIComponent(id)}`));

server.registerTool("search", { description: "Keyword search over item titles and bodies.", inputSchema: { query: z.string() } }, ({ query }) => call(`/api/search?q=${encodeURIComponent(query)}`));

server.registerTool("create_items", {
  description: "Create tasks or notes. dueDate is YYYY-MM-DD; dueTime HH:MM only if a time is stated.",
  inputSchema: {
    items: z.array(z.object({
      title: z.string(), kind: z.enum(["task", "note"]).optional(), listId: z.string().optional(), body: z.string().optional(),
      dueDate: z.string().optional(), dueTime: z.string().optional(), fields: z.record(z.string(), z.unknown()).optional(),
    })).min(1),
  },
}, ({ items }) => call("/api/items", { body: items }));

server.registerTool("update_items", {
  description: "Edit, check off, or move items.",
  inputSchema: {
    updates: z.array(z.object({
      id: z.string(), title: z.string().optional(), body: z.string().optional(), checked: z.boolean().optional(),
      dueDate: z.string().nullable().optional(), dueTime: z.string().nullable().optional(), listId: z.string().optional(),
      fields: z.record(z.string(), z.unknown()).optional(),
    })).min(1),
  },
}, async ({ updates }) => {
  const results: unknown[] = [];
  for (const { id, ...patch } of updates) {
    const r = await call(`/api/items/${encodeURIComponent(id)}`, { method: "PATCH", body: patch });
    results.push({ id, ok: !r.isError, result: r.content[0].text });
  }
  return { content: [{ type: "text" as const, text: JSON.stringify(results) }] };
});

server.connect(new StdioServerTransport()).catch((e) => { console.error(e); process.exit(1); });

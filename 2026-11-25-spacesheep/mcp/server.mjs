#!/usr/bin/env node
// Paddock MCP server (stdio). Talks to the REST API using PADDOCK_URL and PADDOCK_API_KEY.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = (process.env.PADDOCK_URL || "http://localhost:3000").replace(/\/$/, "");
const KEY = process.env.PADDOCK_API_KEY || "dev-key";

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return data;
}
const ok = (data) => ({ content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] });
const wrap = (fn) => async (args) => {
  try { return ok(await fn(args)); } catch (e) { return { isError: true, content: [{ type: "text", text: String(e.message || e) }] }; }
};

const server = new McpServer({ name: "paddock", version: "0.1.0" });

server.registerTool("create_space", {
  description: "Publish an HTML page as a new Paddock space. Returns id, slug and share URL.",
  inputSchema: { title: z.string(), html: z.string(), visibility: z.enum(["private", "public"]).optional(), slug: z.string().optional() },
}, wrap((a) => api("POST", "/api/spaces", a)));

server.registerTool("create_version", {
  description: "Publish a new version of an existing space (by id or slug).",
  inputSchema: { id: z.string(), html: z.string(), note: z.string().optional() },
}, wrap(({ id, ...b }) => api("POST", `/api/spaces/${encodeURIComponent(id)}/versions`, b)));

server.registerTool("list_spaces", {
  description: "List all spaces, optionally filtered by a keyword query.",
  inputSchema: { q: z.string().optional() },
}, wrap(({ q }) => api("GET", "/api/spaces" + (q ? `?q=${encodeURIComponent(q)}` : ""))));

server.registerTool("get_space", {
  description: "Get a space (metadata, current version, current HTML) by id or slug.",
  inputSchema: { id: z.string() },
}, wrap(({ id }) => api("GET", `/api/spaces/${encodeURIComponent(id)}`)));

server.registerTool("list_comments", {
  description: "List comments on a space, including agent replies and diffs.",
  inputSchema: { id: z.string() },
}, wrap(({ id }) => api("GET", `/api/spaces/${encodeURIComponent(id)}/comments`)));

server.registerTool("reply_comment", {
  description: "Post a comment/reply on a space. Include @paddock in the body to trigger an AI edit of the pinned block.",
  inputSchema: { id: z.string(), body: z.string(), block: z.string().regex(/^b\d+$/).optional(), parent_id: z.string().optional(), author: z.string().optional() },
}, wrap(({ id, author, ...b }) => api("POST", `/api/spaces/${encodeURIComponent(id)}/comments`, { author: author || "agent", ...b })));

server.registerTool("restore_version", {
  description: "Restore an older version; creates a new version whose content equals the old one.",
  inputSchema: { id: z.string(), n: z.number().int().positive() },
}, wrap(({ id, n }) => api("POST", `/api/spaces/${encodeURIComponent(id)}/versions/${n}/restore`, {})));

await server.connect(new StdioServerTransport());

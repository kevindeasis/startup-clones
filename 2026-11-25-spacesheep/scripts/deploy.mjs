#!/usr/bin/env node
// Mimics `npx spacesheep deploy <file>`: publishes an HTML file to Paddock and prints the share URL.
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (!file) { console.error("usage: node scripts/deploy.mjs <file.html> [--title T] [--public]"); process.exit(1); }
const base = (process.env.PADDOCK_URL || "http://localhost:3000").replace(/\/$/, "");
const html = fs.readFileSync(file, "utf8");
const title = opt("--title") || path.basename(file, path.extname(file));
const res = await fetch(`${base}/api/spaces`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${process.env.PADDOCK_API_KEY || "dev-key"}` },
  body: JSON.stringify({ title, html, visibility: args.includes("--public") ? "public" : "private" }),
});
const data = await res.json().catch(() => ({}));
if (!res.ok) { console.error(`deploy failed (${res.status}):`, data.error || data); process.exit(1); }
console.log(`${base}/s/${data.slug}`);

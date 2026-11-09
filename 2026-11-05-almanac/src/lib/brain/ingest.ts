import fs from "node:fs";
import path from "node:path";
import { addSource, listSources } from "../store";
import type { Source, SourceKind } from "../types";

export function inferKind(filename: string, text: string): SourceKind {
  const f = filename.toLowerCase();
  if (f.endsWith(".json")) return "slack";
  if (f.endsWith(".csv")) return "csv";
  if (/^email|\.eml$/.test(f) || /^subject:/im.test(text)) return "email";
  if (/^meeting|notes/.test(f)) return "meeting";
  if (f.endsWith(".md")) return "markdown";
  return "text";
}
export function inferTitle(filename: string, text: string): string {
  const h = text.match(/^#\s+(.+)$/m)?.[1] ?? text.match(/^Subject:\s*(.+)$/im)?.[1];
  return (h ?? path.basename(filename, path.extname(filename)).replace(/[-_]+/g, " ")).trim();
}
export function ingestText(filename: string, text: string): Source {
  return addSource({ title: inferTitle(filename, text), kind: inferKind(filename, text), text });
}
export function ingestFile(file: string): Source {
  return ingestText(path.basename(file), fs.readFileSync(file, "utf8"));
}
export function loadSamples(): Source[] {
  const dir = path.resolve(process.cwd(), "samples");
  const have = new Set(listSources().map((s) => s.title));
  const out: Source[] = [];
  for (const f of fs.readdirSync(dir).sort()) {
    const text = fs.readFileSync(path.join(dir, f), "utf8");
    if (have.has(inferTitle(f, text))) continue;
    out.push(ingestText(f, text));
  }
  return out;
}

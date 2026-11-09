import { Command } from "commander";
import fs from "node:fs";
import { streamText } from "ai";
import { compile } from "./lib/brain/compile";
import { buildChatContext } from "./lib/brain/chat";
import { ingestFile } from "./lib/brain/ingest";
import { getModel } from "./lib/brain/llm";
import { listPages, readPage } from "./lib/store";

try { process.loadEnvFile(".env"); } catch { /* no .env file */ }

const program = new Command().name("brain").description("Company Brain CLI");

program.command("ingest <files...>").description("add text/markdown/json/csv files as sources").action((files: string[]) => {
  for (const f of files) {
    if (!fs.existsSync(f)) { console.error(`missing: ${f}`); process.exitCode = 1; continue; }
    const s = ingestFile(f);
    console.log(`source ${s.id}\t${s.kind}\t${s.title}`);
  }
});

program.command("compile").description("compile new sources into the wiki").action(async () => {
  const run = await compile();
  console.log(`provider=${run.provider} sources=${run.sourceIds.length} pagesChanged=${run.pagesChanged.length} tasksAdded=${run.tasksAdded ?? 0}`);
  for (const p of run.pagesChanged) console.log(`  ${p}`);
});

program.command("ask <question>").description("ask the brain").action(async (question: string) => {
  const { system } = buildChatContext(question);
  const { model } = getModel();
  const result = streamText({ model, system, prompt: question });
  for await (const chunk of result.textStream) process.stdout.write(chunk);
  process.stdout.write("\n");
});

const wiki = program.command("wiki").description("read the wiki");
wiki.command("ls").description("list pages").action(() => {
  for (const p of listPages()) console.log(`${p.path}\t${p.title}`);
});
wiki.command("cat <page>").description("print a page").action((page: string) => {
  const p = readPage(page.endsWith(".md") ? page : `${page}.md`);
  if (!p) { console.error("not found"); process.exitCode = 1; return; }
  console.log(fs.readFileSync(`${process.env.DATA_DIR || "./data"}/wiki/${p.path}`, "utf8"));
});

program.parseAsync().catch((e) => { console.error(e); process.exit(1); });

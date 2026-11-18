import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`ok - ${msg}`);
};

const port = await freePort();
const dataDir = mkdtempSync(join(tmpdir(), "permitly-"));
const env = { ...process.env, PORT: String(port), DATA_DIR: dataDir, LLM_MOCK: "1" };
delete env.ANTHROPIC_API_KEY;
const server = spawn("npx", ["next", "start", "-p", String(port)], { env, stdio: ["ignore", "pipe", "pipe"], detached: true });
let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));
const stop = () => {
  try { process.kill(-server.pid, "SIGTERM"); } catch {}
  rmSync(dataDir, { recursive: true, force: true });
};
const base = `http://127.0.0.1:${port}`;
let code = 0;
try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(base)).ok) break; } catch {}
    if (i === 59) throw new Error(`server did not start:\n${log}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  const home = await fetch(base);
  assert(home.status === 200 && (await home.text()).includes("Pinecrest"), "GET / is 200 and mentions Pinecrest");

  const seed = await (await fetch(`${base}/api/seed`, { method: "POST" })).json();
  assert(seed.applications.length === 3, "POST /api/seed loads 3 applications");
  const adu = seed.applications.find((a) => a.permitType === "adu");

  const chat = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "I want to build a 6 foot fence in my backyard" }] }] }),
  });
  const chatText = await chat.text();
  assert(chat.status === 200, "POST /api/chat is 200");
  assert(/fence/i.test(chatText), "chat stream mentions fence");
  assert(JSON.parse(chat.headers.get("x-permit-candidates")).includes("fence"), "x-permit-candidates includes fence");

  const rev = await (await fetch(`${base}/api/applications/${adu.id}/review`, { method: "POST" })).json();
  const fails = rev.checks.filter((c) => c.status === "fail");
  const needs = rev.checks.filter((c) => c.status === "needs_info");
  assert(fails.length >= 1 && needs.length >= 1, "review has a fail and a needs_info check");
  assert(rev.checks.every((c) => c.citation && c.citation.length > 0), "every check has a citation");

  const rep = await (await fetch(`${base}/api/applications/${adu.id}/report`, { method: "POST" })).json();
  assert(typeof rep.report === "string" && rep.report.includes("Recommendation"), "report is Markdown with Recommendation");
  console.log("SMOKE PASSED");
} catch (e) {
  console.error(e.message);
  code = 1;
} finally {
  stop();
}
process.exit(code);

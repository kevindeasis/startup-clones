// End-to-end HTTP smoke test. Starts the production server (`next start`) on a free port with a
// temporary DATA_DIR, runs the acceptance checks in mock mode, prints SMOKE PASSED, stops the server.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

// Whitespace-insensitive: segments are joined with spaces, the source may have none (e.g. `(“`).
const norm = (s) => s.replace(/\s+/g, "");
let step = 0;
const ok = (msg) => console.log(`  ok ${++step} - ${msg}`);

async function main() {
  if (!fs.existsSync(path.join(root, ".next", "BUILD_ID"))) throw new Error("No production build found. Run `npm run build` first.");
  const port = process.env.PORT ? Number(process.env.PORT) : await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fullcast-smoke-"));
  const env = { ...process.env, PORT: String(port), DATA_DIR: dataDir, LLM_MODE: "mock", ALLOW_PRIVATE_URLS: "1", MOCK_CHUNK_DELAY_MS: "0" };
  delete env.ANTHROPIC_API_KEY;
  const server = spawn(process.execPath, [path.join(root, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port)], {
    cwd: root, env, stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  server.stdout.on("data", (d) => (serverLog += d));
  server.stderr.on("data", (d) => (serverLog += d));
  const base = `http://127.0.0.1:${port}`;

  // A tiny local "website" to exercise Readability URL import.
  const site = createServer((_req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(`<!doctype html><html><head><title>The Lantern Keeper - Test Page</title></head><body>
      <nav><a href="/">Home</a> <a href="/x">About</a></nav>
      <article><h1>The Lantern Keeper</h1>
      <p>${"The old keeper climbed the tower every evening to light the lantern above the grey sea. ".repeat(8)}</p>
      <p>"Is the light ready?" asked Mira. "It is," said the keeper, "it always is." ${"Waves rolled in below the rocks. ".repeat(10)}</p>
      <p>${"Night settled over the harbour while the boats found their way home by the light. ".repeat(8)}</p></article>
      <footer>Copyright junk</footer></body></html>`);
  });
  await new Promise((r) => site.listen(0, "127.0.0.1", r));
  const sitePort = site.address().port;

  const stop = async () => {
    site.close();
    if (server.exitCode === null) {
      server.kill("SIGTERM");
      await new Promise((r) => { const t = setTimeout(() => { server.kill("SIGKILL"); r(); }, 4000); server.on("exit", () => { clearTimeout(t); r(); }); });
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  };

  try {
    let ready = false;
    for (let i = 0; i < 120 && !ready; i++) {
      if (server.exitCode !== null) throw new Error(`Server exited early:\n${serverLog}`);
      try { ready = (await fetch(`${base}/api/samples`)).ok; } catch { await new Promise((r) => setTimeout(r, 250)); }
    }
    assert.ok(ready, `server did not start:\n${serverLog}`);
    console.log(`server up on ${base}`);

    const j = async (url, init) => {
      const res = await fetch(base + url, init);
      const body = await res.json().catch(() => null);
      return { res, body };
    };
    const post = (url, data) => j(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });

    // 1. samples
    const samples = await j("/api/samples");
    assert.equal(samples.res.status, 200);
    assert.equal(samples.body.samples.length, 2);
    ok(`GET /api/samples lists 2 samples (${samples.body.samples.map((s) => `${s.id}:${s.words}w`).join(", ")})`);

    for (const sample of samples.body.samples) {
      // 2. create from sample
      const created = await post("/api/stories", { sampleId: sample.id });
      assert.equal(created.res.status, 201);
      assert.equal(created.body.story.status, "imported");
      const id = created.body.story.id;
      ok(`POST /api/stories {sampleId:${sample.id}} -> ${id} (imported)`);

      // 3. generate (sync)
      const gen = await post(`/api/stories/${id}/generate?sync=1`, {});
      assert.equal(gen.body.status, "ready", JSON.stringify(gen.body));
      assert.equal(gen.body.mode, "mock");
      ok(`generate?sync=1 -> ready, mode mock (${gen.body.chunksDone}/${gen.body.chunksTotal} chunks)`);

      // 4. story content
      const { body: story } = await j(`/api/stories/${id}`);
      assert.equal(story.status, "ready");
      assert.equal(story.mode, "mock");
      assert.ok(story.segments.length >= 40, `segments: ${story.segments.length}`);
      const narrators = story.cast.filter((c) => c.isNarrator);
      const named = story.cast.filter((c) => !c.isNarrator && c.name !== "Unknown Speaker");
      assert.equal(narrators.length, 1);
      assert.ok(story.cast.length >= 4, `cast: ${story.cast.length}`);
      assert.ok(named.length >= 3, `named speakers: ${named.map((c) => c.name)}`);
      const joined = norm(story.segments.map((s) => s.text).join(" "));
      const text = fs.readFileSync(path.join(root, "src", "samples", `${sample.id}.txt`), "utf8");
      let from = 0;
      for (const p of text.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean)) {
        const probe = norm(p).slice(0, 20); // first 20 non-space chars
        const at = joined.indexOf(probe, from);
        assert.ok(at >= 0, `paragraph start not found in order: "${probe}"`);
        from = at + 1;
      }
      ok(`${sample.id}: ${story.segments.length} segments, cast ${story.cast.length} [${story.cast.map((c) => c.name).join(", ")}], paragraph coverage in order`);

      if (sample.id === "alice") {
        // 5. PATCH cast
        const target = named[0];
        const patched = await j(`/api/stories/${id}/cast`, {
          method: "PATCH", headers: { "content-type": "application/json" },
          body: JSON.stringify({ characterId: target.id, voice: { pitch: 1.55, rate: 0.8 } }),
        });
        assert.equal(patched.res.status, 200);
        const again = (await j(`/api/stories/${id}`)).body.cast.find((c) => c.id === target.id);
        assert.equal(again.voice.pitch, 1.55);
        assert.equal(again.voice.rate, 0.8);
        const bad = await j(`/api/stories/${id}/cast`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ characterId: target.id, voice: { pitch: 9 } }) });
        assert.equal(bad.res.status, 400);
        ok(`PATCH cast changed ${target.name} pitch to 1.55 and persisted; out-of-range pitch -> 400`);

        // 6. export
        const txt = await fetch(`${base}/api/stories/${id}/export?format=txt`);
        assert.equal(txt.status, 200);
        assert.match(txt.headers.get("content-type"), /^text\/plain/);
        const txtBody = await txt.text();
        assert.match(txtBody, /^NARRATOR: /m);
        const js = await fetch(`${base}/api/stories/${id}/export?format=json`);
        assert.equal(js.status, 200);
        assert.match(js.headers.get("content-type"), /^application\/json/);
        const exported = await js.json();
        assert.ok(exported.title && Array.isArray(exported.cast) && Array.isArray(exported.segments));
        ok("export txt (text/plain) and json (application/json) return 200 with correct content types");
      }

      // 8. delete
      const del = await j(`/api/stories/${id}`, { method: "DELETE" });
      assert.equal(del.res.status, 200);
      assert.equal((await j(`/api/stories/${id}`)).res.status, 404);
      ok(`DELETE works (${sample.id})`);
    }

    // URL import
    const bad = await post("/api/stories", { url: "ftp://x" });
    assert.equal(bad.res.status, 400);
    assert.ok(bad.body.error);
    ok(`URL import rejects ftp://x with 400 ("${bad.body.error}")`);
    const viaUrl = await post("/api/stories", { url: `http://127.0.0.1:${sitePort}/story` });
    assert.equal(viaUrl.res.status, 201, JSON.stringify(viaUrl.body));
    assert.equal(viaUrl.body.story.source.kind, "url");
    assert.match(viaUrl.body.story.title, /Lantern Keeper/);
    const urlGen = await post(`/api/stories/${viaUrl.body.story.id}/generate?sync=1`, {});
    assert.equal(urlGen.body.status, "ready");
    const urlStory = (await j(`/api/stories/${viaUrl.body.story.id}`)).body;
    assert.ok(urlStory.cast.some((c) => c.name === "Mira"), "Mira should be discovered from the imported article");
    assert.ok(!urlStory.segments.some((s) => /Copyright junk/.test(s.text)), "Readability should drop the footer");
    ok(`URL import via Readability: "${viaUrl.body.story.title}", ${urlStory.segments.length} segments, cast [${urlStory.cast.map((c) => c.name).join(", ")}]`);

    // Async generate path (after()) with polling
    const asyncCreated = await post("/api/stories", { sampleId: "oz" });
    const aid = asyncCreated.body.story.id;
    const started = await post(`/api/stories/${aid}/generate`, {});
    assert.equal(started.body.status, "generating");
    let final;
    for (let i = 0; i < 60; i++) {
      final = (await j(`/api/stories/${aid}`)).body;
      if (final.status !== "generating") break;
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.equal(final.status, "ready", JSON.stringify({ s: final.status, e: final.error }));
    assert.ok(final.segments.length >= 40);
    await j(`/api/stories/${aid}`, { method: "DELETE" });
    ok(`async generate (background) completed: ${final.chunksDone}/${final.chunksTotal} chunks`);

    // Library and workspace pages render
    const lib = await fetch(`${base}/`);
    assert.equal(lib.status, 200);
    assert.equal((await fetch(`${base}/stories/doesnotexist`)).status, 404);
    ok("GET / returns 200; unknown story page returns 404");

    console.log("SMOKE PASSED");
  } finally {
    await stop();
  }
}

main().catch((e) => {
  console.error("SMOKE FAILED:", e && e.stack ? e.stack : e);
  process.exit(1);
});

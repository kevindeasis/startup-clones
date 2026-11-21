import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkUrl } from "@/lib/ssrf";
import { store } from "@/lib/store";
import { applyWatchlistPatch } from "@/lib/watchlists";
import type { Obligor } from "@/lib/types";

describe("SSRF guard", () => {
  it("rejects file:// and non-http schemes", () => {
    expect(checkUrl("file:///etc/passwd")).toMatch(/http/);
    expect(checkUrl("ftp://example.com/x")).toBeTruthy();
  });
  it("rejects loopback, private ranges and localhost", () => {
    expect(checkUrl("http://127.0.0.1/x")).toBeTruthy();
    expect(checkUrl("http://10.0.0.1/")).toBeTruthy();
    expect(checkUrl("http://192.168.1.5/")).toBeTruthy();
    expect(checkUrl("http://localhost:3000/")).toBeTruthy();
    expect(checkUrl("http://[::1]/")).toBeTruthy();
  });
  it("accepts public http(s) URLs", () => {
    expect(checkUrl("https://example.com/news/1")).toBeNull();
  });
});

describe("watchlist patch", () => {
  const wl = { id: "w", name: "W", obligorIds: ["a"], createdAt: "now" };
  it("adds (deduped, valid ids only) and removes", () => {
    const added = applyWatchlistPatch(wl, { add: ["b", "a", "zzz"] }, ["a", "b"]);
    expect(added.obligorIds).toEqual(["a", "b"]);
    const removed = applyWatchlistPatch(added, { remove: ["a"], name: " Renamed " }, ["a", "b"]);
    expect(removed.obligorIds).toEqual(["b"]);
    expect(removed.name).toBe("Renamed");
  });
});

describe("JSON store", () => {
  let dir: string;
  const prev = process.env.DATA_DIR;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "muniwatch-"));
    process.env.DATA_DIR = dir;
  });
  afterAll(async () => {
    process.env.DATA_DIR = prev;
    await rm(dir, { recursive: true, force: true });
  });

  it("round-trips obligors, documents, news and watchlists", async () => {
    const o: Obligor = {
      id: "x", name: "X", aliases: [], state: "OH", sector: "city", description: "d", metrics: [], events: [],
      documentIds: [], createdAt: "t", updatedAt: "t",
    };
    await store.saveObligor(o);
    expect(await store.getObligor("x")).toEqual(o);
    expect(await store.getObligor("nope")).toBeUndefined();
    await store.saveWatchlists([{ id: "w", name: "W", obligorIds: ["x"], createdAt: "t" }]);
    expect((await store.listWatchlists())[0].obligorIds).toEqual(["x"]);
    expect(await store.listNews()).toEqual([]);
    await store.saveDocument({
      id: "d1", obligorId: "x", title: "T", type: "audit", filename: "f.txt", pageCount: 1, pages: ["p"], chunks: [],
      status: "indexed", mode: "mock", createdAt: "t",
    });
    expect((await store.getDocument("d1"))?.pages).toEqual(["p"]);
  });
});

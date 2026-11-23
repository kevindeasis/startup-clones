import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "prebid-store-"));
  process.env.DATA_DIR = dir;
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("json store", () => {
  it("serialises concurrent read-modify-write cycles", async () => {
    const { updateCollection, readCollection } = await import("../src/lib/store");
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        updateCollection<{ id: string }>("notes", async (items) => {
          await new Promise((r) => setTimeout(r, 1));
          items.push({ id: String(i) });
        }),
      ),
    );
    expect(await readCollection("notes")).toHaveLength(25);
  });
});

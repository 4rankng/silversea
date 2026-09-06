import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { writeArtifact, sleep } from "./ui-driver.mjs";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("writeArtifact", () => {
  test("creates the dir and writes pretty-printed JSON", () => {
    const root = mkdtempSync(join(tmpdir(), "ui-driver-test-"));
    try {
      const file = writeArtifact(join(root, "nested", "deep"), "result.json", { a: 1, b: ["x"] });
      const content = readFileSync(file, "utf8");
      assert.equal(content, `${JSON.stringify({ a: 1, b: ["x"] }, null, 2)}\n`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("sleep", () => {
  test("resolves only after ~ms milliseconds (not faster)", async () => {
    const start = Date.now();
    await sleep(40);
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 35, `elapsed=${elapsed}ms — should be ≥ 35ms`);
  });
});

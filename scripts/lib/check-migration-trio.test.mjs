import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { snapshotCoverage, trioViolations } from "../check-migration-trio.mjs";

/**
 * Card 20260928_188. The check these tests cover is the one commit 5bd7d0b8
 * claimed to have run ("Validated with node scripts/check-migration-trio.mjs")
 * and that guard-journal-append-only.mjs still tells operators to run. It did
 * not exist. It exists now, so these pins make sure it keeps saying something
 * true.
 *
 * Every negative case below asserts a specific violation string, not merely a
 * non-empty list: a gate that returns "something is wrong" for the wrong reason
 * is as useless as no gate, because the operator cannot tell which law broke.
 */
const REPO = fileURLToPath(new URL("../..", import.meta.url));
const DRIZZLE = join(REPO, "backend", "drizzle");

const journal = JSON.parse(readFileSync(join(DRIZZLE, "meta", "_journal.json"), "utf8"));
const realEntries = journal.entries;
const realSql = readdirSync(DRIZZLE)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => f.slice(0, -".sql".length));

/** Deep-cloned copy so a mutation in one test cannot leak into the next. */
const entries = () => JSON.parse(JSON.stringify(realEntries));
const has = (violations, fragment) =>
  violations.some((v) => v.includes(fragment));

describe("check-migration-trio", () => {
  test("the real repository journal is coherent", () => {
    const violations = trioViolations(entries(), realSql);
    assert.deepEqual(
      violations,
      [],
      `the shipped migration set must be clean; got:\n  ${violations.join("\n  ")}`,
    );
  });

  test("a journal entry with no .sql file is reported", () => {
    const list = realSql.slice(1);
    const violations = trioViolations(entries(), list);
    assert.ok(has(violations, "has no migration file"), violations.join("; "));
  });

  test("an .sql file with no journal entry is reported (the reverse orphan)", () => {
    const violations = trioViolations(entries(), [...realSql, "9999_never_journalled"]);
    assert.ok(has(violations, "has no journal entry"), violations.join("; "));
  });

  test("a duplicate idx is reported — this is the renumber-onto-another class", () => {
    const list = entries();
    list[50].idx = list[49].idx;
    const violations = trioViolations(list, realSql);
    assert.ok(has(violations, "duplicate journal idx"), violations.join("; "));
  });

  test("a non-increasing idx is reported even when no idx repeats", () => {
    // Renumbering a block DOWN by one leaves every idx unique but breaks
    // strict increase at the seam. Duplicate-idx alone would miss this.
    const list = entries();
    for (let i = 61; i < 62; i += 1) list[i].idx -= 1;
    const violations = trioViolations(list, realSql);
    assert.ok(has(violations, "must strictly increase"), violations.join("; "));
  });

  test("an interior idx gap is NOT a violation — it is a legal scar", () => {
    // The 2026-09-24/27 idx-127 hole. `idx === position` would be red here
    // forever, because the append-only law forbids repairing it by renumbering.
    // Asserting the gap is tolerated is what keeps this gate satisfiable.
    const list = entries();
    for (let i = 61; i < list.length; i += 1) list[i].idx += 1;
    assert.deepEqual(trioViolations(list, realSql), []);
  });

  test("a `when` that goes backwards is reported", () => {
    const list = entries();
    list[50].when = list[49].when - 1; // one millisecond is enough
    const violations = trioViolations(list, realSql);
    assert.ok(has(violations, "migration order would be ambiguous"), violations.join("; "));
  });

  test("equal `when` values are tolerated — drizzle ties are legal", () => {
    const list = entries();
    list[50].when = list[49].when;
    assert.deepEqual(trioViolations(list, realSql), []);
  });

  test("a duplicate tag is reported", () => {
    const list = entries();
    list[50].tag = list[49].tag;
    const violations = trioViolations(list, realSql);
    assert.ok(has(violations, "duplicate journal tag"), violations.join("; "));
  });

  test("a renamed genesis entry is reported", () => {
    const list = entries();
    list[0].tag = "0000_something_else-baseline";
    const violations = trioViolations(list, realSql);
    assert.ok(has(violations, "genesis entry is"), violations.join("; "));
  });

  test("an empty journal is refused rather than silently passing", () => {
    assert.ok(has(trioViolations([], realSql), "journal has no entries"));
  });

  test("snapshot coverage resolves both naming conventions", () => {
    const meta = readdirSync(join(DRIZZLE, "meta"));
    const { viaIdx, viaTag, unresolved } = snapshotCoverage(entries(), meta);
    assert.ok(viaIdx > 0, "legacy NNNN_snapshot.json files must resolve by idx");
    assert.ok(viaTag > 0, "timestamp-era snapshot files must resolve by tag prefix");
    // 46 entries have no snapshot under either convention — pre-existing, and
    // deliberately not gated. Pinned so the number cannot silently grow.
    assert.equal(
      unresolved.length,
      46,
      `snapshot coverage changed (${viaIdx} by idx, ${viaTag} by tag, ${unresolved.length} unresolved) — if a snapshot was dropped, investigate`,
    );
  });
});

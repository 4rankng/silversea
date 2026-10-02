#!/usr/bin/env node
// check-migration-trio.mjs — the migration coherence check.
//
// WHY THIS FILE EXISTS (card 20260928_188)
// -----------------------------------------
// Commit 5bd7d0b8 (2026-09-27) closed with "Validated with
// `node scripts/check-migration-trio.mjs`". That script did not exist — it has
// never existed in any revision of this repository. Worse, the append-only
// guard kept pointing operators at it: `guard-journal-append-only.mjs` prints
// "Validate the file afterwards with: node scripts/check-migration-trio.mjs" as
// its remedy line, so a nonexistent command was being advertised from two
// places. A verify command cited in a commit message or in a guard's own output
// has to run; otherwise "already verified" means nothing.
//
// So the check now exists, for real, and it is the thing both places refer to.
//
// WHAT IT CHECKS
// --------------
// The three artefacts of a Drizzle migration are the journal
// (`drizzle/meta/_journal.json`), the SQL files it names, and the snapshots it
// leaves behind. This validates the first two as a bijection and pins the
// ordering laws the runtime migrator depends on. Snapshots are reported, not
// gated — see "SNAPSHOTS" below for why a coverage gate would be a false alarm.
//
// Usage:  node scripts/check-migration-trio.mjs
// Exit:   0 = coherent · 1 = at least one hard failure
//
// The judgement lives in `trioViolations`, a pure function, so it can be
// unit-tested without a Drizzle tree on disk (scripts/lib/check-migration-trio
// .test.mjs). The CLI below is a thin shell that reads the repo and prints.
// This mirrors guard-journal-append-only.mjs, which exports the same way.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The genesis entry the repo consolidated onto; a rename here is not append-only. */
const GENESIS_TAG = '0000_flexible-baseline';

/**
 * Report every way a migration set is incoherent.
 *
 * @param {Array<{idx:number,tag:string,when:number}>} entries journal entries
 * @param {string[]} sqlFiles  .sql basenames present in drizzle/
 * @returns {string[]} violations; empty means coherent
 */
export function trioViolations(entries, sqlFiles) {
  const failures = [];
  const fail = (msg) => failures.push(msg);

  if (!Array.isArray(entries) || entries.length === 0) {
    return ['journal has no entries'];
  }

  // ---- 1. journal ↔ .sql is a bijection ------------------------------------
  const sqlSet = new Set(sqlFiles);
  const tags = new Set();
  for (const [i, e] of entries.entries()) {
    if (tags.has(e.tag)) fail(`duplicate journal tag "${e.tag}" (position ${i})`);
    tags.add(e.tag);
    if (!sqlSet.has(e.tag)) {
      fail(`journal entry ${i} (idx ${e.idx}, ${e.tag}) has no migration file at drizzle/${e.tag}.sql`);
    }
  }
  for (const tag of sqlSet) {
    if (!tags.has(tag)) fail(`migration file drizzle/${tag}.sql has no journal entry`);
  }

  // ---- 2. idx: unique and strictly increasing ------------------------------
  // This is the law that survives the append-only rule. A delete, reorder or
  // renumber in the middle of the journal all break it, which is exactly the
  // failure class guard-journal-append-only.mjs exists to catch at commit time.
  // `idx === position` is deliberately NOT asserted: the repo's append-only law
  // forbids repairing a historical gap by renumbering, so a contiguity gate
  // could never be satisfied. See backend/src/tests/helpers/journal-invariants.ts.
  const seenIdx = new Set();
  for (const [i, e] of entries.entries()) {
    if (seenIdx.has(e.idx)) {
      fail(`duplicate journal idx ${e.idx} (position ${i}, ${e.tag}) — an entry was renumbered onto another`);
    }
    seenIdx.add(e.idx);
    if (i > 0) {
      const prev = entries[i - 1];
      if (!(e.idx > prev.idx)) {
        fail(
          `entry ${i} (${e.tag}) has idx ${e.idx} after ${prev.tag} (idx ${prev.idx}) — ` +
            'indices must strictly increase; an interior delete, renumber or reorder is illegal',
        );
      }
    }
  }

  // ---- 3. `when` must not go backwards -------------------------------------
  // The runtime migrator keys __drizzle_migrations by `when`/hash, so a `when`
  // that decreases would make drizzle apply a migration that was already applied
  // (or skip one). Equal values are legal — drizzle tolerates ties.
  for (let i = 1; i < entries.length; i += 1) {
    if (entries[i].when < entries[i - 1].when) {
      fail(
        `entry ${i} (${entries[i].tag}) has when ${entries[i].when} before ` +
          `${entries[i - 1].tag} (when ${entries[i - 1].when}) — migration order would be ambiguous`,
      );
    }
  }

  // ---- 4. genesis is the consolidated baseline -----------------------------
  if (entries[0].tag !== GENESIS_TAG) {
    fail(`genesis entry is "${entries[0].tag}", expected "${GENESIS_TAG}"`);
  }

  return failures;
}

/**
 * Snapshot coverage, reported but never gated.
 *
 * Three snapshot naming shapes coexist: legacy `NNNN_snapshot.json` keyed on
 * idx, timestamp-era `<YYYYMMDDHHMMSS>_snapshot.json` keyed on the tag's
 * timestamp prefix, and the full-tag `<ts>_<slug>_snapshot.json` — the
 * hand-written trio norm since drizzle-kit generate was blocked. A legacy tail
 * resolves under NONE of the three because its tag-embedded number is offset
 * from idx by exactly 4 — four indices were dropped early in this repo's
 * history, so the tag counter and the idx counter have disagreed since long
 * before the current team touched it. A snapshot-coverage gate would therefore
 * be red on a healthy tree, which teaches people to ignore it. The residue is
 * surfaced as information (and pinned by the unit test) so a future drop is
 * still visible.
 *
 * @returns {{viaIdx:number, viaTag:number, unresolved:string[]}}
 */
export function snapshotCoverage(entries, metaFiles) {
  const files = new Set(metaFiles);
  let viaIdx = 0;
  let viaTag = 0;
  const unresolved = [];
  for (const e of entries) {
    if (files.has(`${String(e.idx).padStart(4, '0')}_snapshot.json`)) viaIdx += 1;
    else if (files.has(`${e.tag}_snapshot.json`) || files.has(`${e.tag.split('_')[0]}_snapshot.json`)) {
      viaTag += 1;
    } else unresolved.push(`${e.idx}:${e.tag}`);
  }
  return { viaIdx, viaTag, unresolved };
}

// ---- CLI -------------------------------------------------------------------
// Only run when executed directly; importing the pure helpers above must not
// touch the filesystem.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const REPO = fileURLToPath(new URL('..', import.meta.url));
  const DRIZZLE = join(REPO, 'backend', 'drizzle');
  const JOURNAL = join(DRIZZLE, 'meta', '_journal.json');
  const META = join(DRIZZLE, 'meta');

  if (!existsSync(JOURNAL)) {
    console.error(`✗ journal missing: ${relative(REPO, JOURNAL)}`);
    process.exit(1);
  }

  let journal;
  try {
    journal = JSON.parse(readFileSync(JOURNAL, 'utf8'));
  } catch (err) {
    // A hand-edit that left invalid JSON is the most likely way to break this
    // file, so say so plainly rather than letting a stack trace stand in.
    console.error(`✗ ${relative(REPO, JOURNAL)} is not valid JSON: ${err.message}`);
    process.exit(1);
  }

  const entries = journal.entries ?? [];
  const sqlFiles = existsSync(DRIZZLE)
    ? readdirSync(DRIZZLE).filter((f) => f.endsWith('.sql')).map((f) => f.slice(0, -'.sql'.length))
    : [];
  const metaFiles = existsSync(META) ? readdirSync(META) : [];

  const last = entries[entries.length - 1];
  console.log(
    `[migration-trio] ${entries.length} journal entries · ${sqlFiles.length} .sql files · ` +
      `last idx ${last?.idx} (${last?.tag})`,
  );

  const { viaIdx, viaTag, unresolved } = snapshotCoverage(entries, metaFiles);
  console.log(`[migration-trio] snapshots: ${viaIdx} by idx name, ${viaTag} by tag name, ${unresolved.length} with no snapshot file`);
  if (unresolved.length) {
    const shown = unresolved.slice(0, 6).join(', ');
    console.log(`[migration-trio]   no-snapshot entries (pre-existing, not gated): ${shown}${unresolved.length > 6 ? ', …' : ''}`);
  }

  const failures = trioViolations(entries, sqlFiles);
  if (failures.length) {
    console.error(`[migration-trio] ✗ ${failures.length} problem(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('[migration-trio] ✓ journal ↔ sql ↔ ordering coherent');
  process.exit(0);
}

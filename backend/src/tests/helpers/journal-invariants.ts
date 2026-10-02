import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Structural invariants for the Drizzle migration journal, shared by
 * unit/o2c-rev1.migration-safety.test.ts and customer-workflow-migration-safety.test.ts.
 *
 * Replaces the former hardcoded `{idx, tag}` arrays: new migrations require
 * zero test edits. What stays protected:
 *   - **strictly increasing** idx, non-decreasing `when` — this is what makes a
 *     delete / renumber / reorder in the middle of the journal impossible to miss
 *   - unique idx and unique tags, legacy index or timestamp tag shape
 *   - every journal entry has its .sql file on disk
 *   - the genesis entry is the consolidated baseline
 *   - the journal never shrinks below a floor passed by each caller
 *   - no index gap other than the ones recorded in `DOCUMENTED_INDEX_GAPS`
 *
 * Why not `idx === position` (the assertion this replaced, 2026-09-28): that
 * demanded contiguous indices, which the repo's own append-only law forbids
 * repairing. `backend/scripts/guard-journal-append-only.mjs` rejects any
 * renumber/delete/reorder of an existing entry at commit time — its header
 * records the 2026-09-24 alarm ("idx renumber 128→127…131→130 on shipped
 * migrations") as exactly the class of edit it exists to stop, and the 2026-09-27
 * signed renumber repair (`5bd7d0b8`) was reverted (`c1075f25`) on that basis.
 * Meanwhile the hole itself is a legal scar: drizzle-kit numbers the next entry
 * `lastEntry.idx + 1` (bin.cjs, `generateMigration`), and the runtime migrator
 * keys `__drizzle_migrations` by `when`/hash, so an interior gap changes nothing
 * mechanically. `idx === position` was therefore unsatisfiable while the law
 * held, which left the guard permanently red — a guard nobody can satisfy
 * protects nothing. Strictly-increasing indices catch the same failure (any
 * interior delete/renumber makes the sequence non-increasing or repeats an idx)
 * and the gap allowlist below makes a NEW hole louder than the old assertion did.
 */

const drizzleDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../drizzle');

const GENESIS_TAG = '0000_flexible-baseline';
const TAG_PATTERN = /^(?:\d{4}|\d{14})_\S+$/;

/**
 * Index gaps that exist in shipped history and must NOT be "repaired" by
 * renumbering (the append-only guard rejects that). A gap that is not listed
 * here fails the invariant — that is the tripwire for a silently deleted
 * migration.
 */
const DOCUMENTED_INDEX_GAPS: Record<number, string> = {
  127: '19a77628 (2026-09-24): the never-committed 20260924021509_high_valkyrie was regenerated as 20260924035509_seed_name_suffix_strip and committed at idx 128, leaving 127 empty. No .sql for it ever existed, so nothing was ever applied for it.',
};

export interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

export interface Journal {
  entries: JournalEntry[];
}

export async function readJournal(): Promise<Journal> {
  return JSON.parse(await readFile(path.join(drizzleDir, 'meta/_journal.json'), 'utf8')) as Journal;
}

export async function assertJournalInvariants(journal: Journal, minCount: number): Promise<void> {
  const { entries } = journal;

  assert.ok(
    entries.length >= minCount,
    `journal shrank to ${entries.length} entries (floor ${minCount}) — migrations must be append-only`,
  );

  const seenTags = new Set<string>();
  const seenIdx = new Set<number>();
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]!;
    assert.match(entry.tag, TAG_PATTERN, `tag "${entry.tag}" must use an index or timestamp prefix`);
    assert.ok(!seenTags.has(entry.tag), `duplicate journal tag "${entry.tag}"`);
    assert.ok(!seenIdx.has(entry.idx), `duplicate journal idx ${entry.idx} (entry ${i}, ${entry.tag}) — an entry was renumbered onto another`);
    seenTags.add(entry.tag);
    seenIdx.add(entry.idx);

    if (i > 0) {
      const prev = entries[i - 1]!;
      assert.ok(
        entry.idx > prev.idx,
        `entry ${i} (${entry.tag}) has idx ${entry.idx} after ${prev.tag} (idx ${prev.idx}) — indices must strictly increase; an interior delete, renumber or reorder is illegal (see scripts/guard-journal-append-only.mjs)`,
      );
      assert.ok(
        prev.when <= entry.when,
        `entry ${i} (${entry.tag}) has a timestamp before entry ${i - 1} (${prev.tag}) — history may have been regenerated`,
      );
      for (let gap = prev.idx + 1; gap < entry.idx; gap += 1) {
        assert.ok(
          DOCUMENTED_INDEX_GAPS[gap] !== undefined,
          `journal index ${gap} is missing between ${prev.tag} (idx ${prev.idx}) and ${entry.tag} (idx ${entry.idx}) — a migration was deleted from the middle of history. If this is a deliberate, lead-signed revert, record the gap in DOCUMENTED_INDEX_GAPS with the commit that caused it.`,
        );
      }
    }

    const sqlPath = path.join(drizzleDir, `${entry.tag}.sql`);
    await access(sqlPath).catch(() => {
      assert.fail(`journal entry ${entry.idx} (${entry.tag}) has no migration file at ${path.relative(drizzleDir, sqlPath)}`);
    });
  }

  assert.equal(
    entries[0]?.tag,
    GENESIS_TAG,
    `genesis entry must remain ${GENESIS_TAG} (consolidated baseline) — a regenerated history renumbers every tag`,
  );
}

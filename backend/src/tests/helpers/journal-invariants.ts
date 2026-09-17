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
 *   - append-only ordering (contiguous idx from 0, non-decreasing `when`)
 *   - legacy index or timestamp tag shape and uniqueness
 *   - every journal entry has its .sql file on disk
 *   - the genesis entry is the consolidated baseline
 *   - the journal never shrinks below a floor passed by each caller
 */

const drizzleDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../drizzle');

const GENESIS_TAG = '0000_flexible-baseline';
const TAG_PATTERN = /^(?:\d{4}|\d{14})_\S+$/;

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
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]!;
    assert.equal(entry.idx, i, `entry ${i} has idx ${entry.idx} — journal indices must be contiguous from 0`);
    assert.match(entry.tag, TAG_PATTERN, `tag "${entry.tag}" must use an index or timestamp prefix`);
    assert.ok(!seenTags.has(entry.tag), `duplicate journal tag "${entry.tag}"`);
    seenTags.add(entry.tag);
    if (i > 0) {
      assert.ok(
        entries[i - 1]!.when <= entry.when,
        `entry ${i} (${entry.tag}) has a timestamp before entry ${i - 1} (${entries[i - 1]!.tag}) — history may have been regenerated`,
      );
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

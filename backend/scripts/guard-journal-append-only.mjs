#!/usr/bin/env node
// guard-journal-append-only.mjs — the tripwire the drizzle journal never had
// (card 20260924_25). Journal edits are APPEND-ONLY by law: a diff may only
// ADD trailing entries. Any renumber/delete/reorder of an existing entry is
// rejected — the 09-24 21:55 alarm (idx renumber 128→127…131→130 on shipped
// migrations) had zero mechanical tripwires; this guard is the tripwire.
//
// Usage: node scripts/guard-journal-append-only.mjs   (from backend/, or anywhere
// via the pre-commit hook). Read-only on the repo.
//
// Exemption (documented): a lead-signed repair commit carries the trailer
//   Journal-Repair: signed-by <lead>
// in the commit message. The guard detects it in .git/COMMIT_EDITMSG, allows
// the diff, and prints the signature for the landing record. Post-hoc audit:
//   git log --grep 'Journal-Repair:'
//
// Exit: 0 = append-only (or no journal change / signed repair); 1 = violation.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const JOURNAL = 'backend/drizzle/meta/_journal.json';

export function journalViolations(oldEntries, newEntries) {
  const v = [];
  if (newEntries.length < oldEntries.length) {
    v.push(`entries DELETED: ${oldEntries.length} -> ${newEntries.length}`);
  }
  const shared = Math.min(oldEntries.length, newEntries.length);
  for (let i = 0; i < shared; i++) {
    if (JSON.stringify(oldEntries[i]) !== JSON.stringify(newEntries[i])) {
      v.push(`entry at position ${i} (idx ${oldEntries[i].idx}, tag ${oldEntries[i].tag}) was MODIFIED — only trailing appends are legal`);
    }
  }
  return v;
}

function gitShow(rev, path) {
  try {
    return execFileSync('git', ['show', `${rev}:${path}`], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  } catch {
    return null;
  }
}

// Only run as CLI when executed directly (the export stays unit-usable).
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const rel = join(root, JOURNAL);

  // Skip entirely when this commit / worktree carries no journal change.
  const changed = (args) => {
    try {
      const out = execFileSync('git', args, { encoding: 'utf8' });
      return out.split('\n').some((line) => line.trim() === JOURNAL);
    } catch {
      return false;
    }
  };
  const stagedChanged = changed(['diff', '--cached', '--name-only']);
  const worktreeChanged = changed(['diff', 'HEAD', '--name-only']);
  if (!stagedChanged && !worktreeChanged) {
    console.log('[journal-guard] no journal change — pass');
    process.exit(0);
  }

  // Staged content when staged; otherwise the worktree file (pathspec commits
  // read the worktree for named paths).
  const newRaw = stagedChanged ? gitShow(':0', JOURNAL) : readFileSync(rel, 'utf8');
  const oldRaw = gitShow('HEAD', JOURNAL);
  const oldEntries = oldRaw ? (JSON.parse(oldRaw).entries ?? []) : [];
  const newEntries = JSON.parse(newRaw).entries ?? [];
  const violations = journalViolations(oldEntries, newEntries);
  if (violations.length === 0) {
    console.log('[journal-guard] append-only OK ' +
      `(${oldEntries.length} -> ${newEntries.length} entries)`);
    process.exit(0);
  }

  // Lead-signed repair exemption, read from the commit message draft.
  const editmsg = join(root, '.git', 'COMMIT_EDITMSG');
  let signed = false;
  if (existsSync(editmsg)) {
    const text = readFileSync(editmsg, 'utf8');
    if (/^Journal-Repair: signed-by .+/m.test(text)) signed = true;
  }
  if (signed) {
    console.log('[journal-guard] REPAIR SIGNED — Journal-Repair trailer found; allowing non-append diff');
    console.log('[journal-guard] audit: git log --grep \'Journal-Repair:\'');
    process.exit(0);
  }

  console.error('[journal-guard] ✗ REFUSED — _journal.json diff is not append-only:');
  for (const item of violations) console.error('  - ' + item);
  console.error('  Journal edits are append-only: new entries at the tail only.');
  console.error('  Validate the file afterwards with: node scripts/check-migration-trio.mjs');
  console.error('  Lead-signed repair: add the trailer "Journal-Repair: signed-by <lead>" to the commit message.');
  process.exit(1);
}

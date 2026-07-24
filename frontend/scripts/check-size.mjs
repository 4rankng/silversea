#!/usr/bin/env node
/**
 * File-size guard for the frontend codebase.
 *
 * History: the project grew organically and ended up with eight files over
 * 650 lines — `FleetPage.tsx` (1097), `useTripForm.ts` (815), `Layout.tsx`
 * (461), etc. These are impossible to review, test, or refactor safely.
 *
 * This script runs in `pnpm build` (after `tsc -b`) and fails the build
 * when any .ts/.tsx file under `src/` exceeds `MAX_LINES` (600). The
 * budget is generous (most React + TS files should be well under 300 LOC)
 * — it exists to catch runaway growth, not to constrain ordinary code.
 *
 * Override with `--max 800` if a one-off large file is justified, or skip
 * entirely with `SKIP_SIZE_CHECK=1 pnpm build` while a refactor lands.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

let MAX_LINES = Number(process.env.MAX_LINES ?? 600);
const SKIP = process.env.SKIP_SIZE_CHECK === '1';
const SRC = fileURLToPath(new URL('../src', import.meta.url));
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'graphify-out']);

if (SKIP) {
  console.log('[size-check] skipped (SKIP_SIZE_CHECK=1)');
  process.exit(0);
}

const args = process.argv.slice(2);
const maxIdx = args.indexOf('--max');
if (maxIdx >= 0) {
  const customMax = Number(args[maxIdx + 1]);
  if (Number.isFinite(customMax)) MAX_LINES = customMax;
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) yield* walk(full);
    else if (s.isFile() && (extname(entry) === '.ts' || extname(entry) === '.tsx')) {
      yield full;
    }
  }
}

const offenders = [];
for (const file of walk(SRC)) {
  const text = readFileSync(file, 'utf8');
  // Count non-blank lines — comments and blank lines don't count toward
  // the "code" budget.
  const lines = text.split('\n').filter((l) => l.trim().length > 0).length;
  if (lines > MAX_LINES) {
    offenders.push({ file: relative(SRC, file), lines });
  }
}

if (offenders.length === 0) {
  console.log(`[size-check] all files under ${MAX_LINES} non-blank lines ✓`);
  process.exit(0);
}

console.error(`\n[size-check] ${offenders.length} file(s) exceed the ${MAX_LINES}-line budget:\n`);
for (const o of offenders.sort((a, b) => b.lines - a.lines)) {
  console.error(`  ${o.lines.toString().padStart(4)}  src/${o.file}`);
}
console.error(`\nFix by splitting the file. Override with --max <N> or SKIP_SIZE_CHECK=1.\n`);
process.exit(1);

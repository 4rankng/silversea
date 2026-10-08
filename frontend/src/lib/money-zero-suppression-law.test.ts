import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Card 20261002_293 (owner law R28/D02): a computed financial zero is a VALUE.
// The suppression class — `x ? formatCurrency(x) : '—'` and its `x > 0` twin —
// rendered a blank/dash for 0 ₫ and made real amounts look like missing data.
// The formatters own the empty contract (null/NaN → '— ₫'); a page may not
// re-decide it per render. This scan bans the self-same-variable suppression
// shape app-wide. Structural absences (a ledger column whose cell has no
// opposite direction, e.g. `value < 0 ? formatMoney(-value) : '—'`) and
// validity-gated input echoes (condition variable ≠ rendered variable) are
// different shapes and stay legal.

const ROOT = join(process.cwd(), 'src');

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!/(^|\/)(tests?|__tests__|untitled-ui)$/.test(entry)) walk(full, files);
    } else if (/\.(tsx|ts)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

const BANNED = [
  // x > 0 ? formatCurrency(x) : '—'
  /([A-Za-z][\w.]*)\s*>\s*0\s*\?\s*format(?:Currency|Money)\(\s*\1\s*\)\s*:\s*(['"])—\2/,
  // x ? formatCurrency(x) : '—'
  /([A-Za-z][\w.]*)\s*\?\s*format(?:Currency|Money)\(\s*\1\s*\)\s*:\s*(['"])—\2/,
];

describe('money zero-suppression law (card 20261002_293)', () => {
  // Structural ledger split (OpsFundBookSection thu/chi pair): a cash movement
  // is IN or OUT, never zero — the opposite-direction cell's dash means "this
  // row has no such movement" (absence), not "the value is zero". Same shape
  // as the money-matrix absence convention. Dated; removal needs a ruling.
  const ALLOWLIST = new Set([
    'src/features/ops/OpsFundBookSection.tsx',
  ]);

  it('no render suppresses a financial zero into a dash or blank', () => {
    const offenders: string[] = [];
    for (const file of walk(ROOT)) {
      if (ALLOWLIST.has(file.replace(ROOT, 'src'))) continue;
      const css = readFileSync(file, 'utf8');
      for (const pattern of BANNED) {
        if (pattern.test(css)) offenders.push(`${file.replace(ROOT, 'src')}: /${pattern.source.slice(0, 60)}/`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

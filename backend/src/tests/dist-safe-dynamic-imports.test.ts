/**
 * Dist-build safety net (lead directive, fuel-period 500 root cause): an
 * extensionless DYNAMIC import (`await import('../x')`) breaks the compiled
 * tree — the fix-esm-imports rewrite covers static imports only, so runtime
 * resolution fails with ERR_MODULE_NOT_FOUND while every tsx-level gate is
 * green (fuel-period 500 on staging, card _61 rung). This scan covers ALL
 * compiled-tree sources: routes (incl. routes/config), services, and seed.
 * Static imports and explicit-.js dynamic specifiers are the only allowed
 * forms. node:/bare package specifiers are out of scope.
 */
import { describe,  test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = [
  'src/routes',
  'src/services',
  'src/seed',
];

function collectTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectTsFiles(full, out);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.disabled')) {
      out.push(full);
    }
  }
  return out;
}

describe('dist-safe dynamic imports (fuel-period 500 class)', () => {
  test('no extensionless dynamic imports anywhere in the compiled tree', () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of collectTsFiles(root)) {
        const text = readFileSync(file, 'utf8');
        for (const match of text.matchAll(/await import\((['"])(\.[^'"]+)\1\)/g)) {
          if (!match[2]!.endsWith('.js')) offenders.push(`${file}: ${match[2]}`);
        }
      }
    }
    // seed.ts lives at src/seed.ts, not under src/seed/
    const seedEntry = readFileSync('src/seed.ts', 'utf8');
    for (const match of seedEntry.matchAll(/await import\((['"])(\.[^'"]+)\1\)/g)) {
      if (!match[2]!.endsWith('.js')) offenders.push(`src/seed.ts: ${match[2]}`);
    }
    assert.deepEqual(offenders, [], `extensionless dynamic imports break the dist build: ${offenders.join('; ')}`);
  });
});

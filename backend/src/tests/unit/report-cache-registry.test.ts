import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REPORT_CACHE_GROUPS,
  REPORT_CACHE_KEYS,
  dashboardCacheKey,
  dashboardWidgetsMonthKey,
  fuelVarianceMonthKey,
  pnlMonthKey,
} from '../../lib/report-cache';

describe('report-cache registry', () => {
  test('tripWrite group covers every trip/ledger-derived report cache', () => {
    assert.deepEqual([...REPORT_CACHE_GROUPS.tripWrite], [
      REPORT_CACHE_KEYS.dashboard,
      REPORT_CACHE_KEYS.dashboardExecutive,
      REPORT_CACHE_KEYS.entityResultsPattern,
      REPORT_CACHE_KEYS.totalArPattern,
      REPORT_CACHE_KEYS.fuelVariancePattern,
      REPORT_CACHE_KEYS.dashboardWidgetsPattern,
    ]);
  });

  test('tripStart group preserves the historical start-side-effect set exactly (4 keys, no pnl)', () => {
    assert.deepEqual([...REPORT_CACHE_GROUPS.tripStart], [
      REPORT_CACHE_KEYS.dashboard,
      REPORT_CACHE_KEYS.dashboardExecutive,
      REPORT_CACHE_KEYS.entityResultsPattern,
      REPORT_CACHE_KEYS.fuelVariancePattern,
    ]);
  });

  test('every registry key is a reports: key; pnl is group-external and opt-out-able', () => {
    for (const key of Object.values(REPORT_CACHE_KEYS)) {
      assert.ok(key.startsWith('reports:'), `key ${key} must live under the reports: namespace`);
    }
    assert.ok(!(REPORT_CACHE_GROUPS.tripWrite as readonly string[]).includes(REPORT_CACHE_KEYS.pnlPattern));
    assert.ok(!(REPORT_CACHE_GROUPS.tripStart as readonly string[]).includes(REPORT_CACHE_KEYS.pnlPattern));
  });

  test('setters and invalidators share one spelling (builders pin the exact cache shapes)', () => {
    assert.equal(dashboardCacheKey(false), REPORT_CACHE_KEYS.dashboard);
    assert.equal(dashboardCacheKey(true), REPORT_CACHE_KEYS.dashboardExecutive);
    assert.equal(pnlMonthKey(9, 2026), 'reports:pnl:9:2026');
    assert.equal(fuelVarianceMonthKey(9, 2026), 'reports:fuel-variance:9:2026');
    assert.equal(dashboardWidgetsMonthKey(9, 2026), 'reports:dashboard-widgets:9:2026');
    // The unset-params widgets cache shape carries a trailing colon — setter
    // (dashboard-widgets.service) and policy enumerator must keep agreeing.
    assert.equal(dashboardWidgetsMonthKey('current', ''), 'reports:dashboard-widgets:current:');
  });

  test('drift gate: no hand-spelled reports: keys outside the registry (comments stripped)', async () => {
    const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
    const offenders: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'tests') continue; // test assertions may spell keys
          await walk(full);
        } else if (entry.name.endsWith('.ts')) {
          if (full.endsWith(join('lib', 'report-cache.ts'))) continue;
          const raw = await readFile(full, 'utf8');
          const stripped = raw
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/.*$/gm, '');
          // Quoted/backticked `reports:` only — a bare object key like
          // `reports: 'báo cáo'` (audit label map) is not a cache key.
          if (/['`"]reports:/.test(stripped)) offenders.push(full);
        }
      }
    };
    await walk(srcRoot);
    assert.deepEqual(
      offenders,
      [],
      'report-cache keys must be spelled only in lib/report-cache.ts — derive via REPORT_CACHE_KEYS / builders',
    );
  });
});

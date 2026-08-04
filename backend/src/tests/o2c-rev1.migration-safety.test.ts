import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const baselineUrl = new URL('../../drizzle/0000_flexible-baseline.sql', import.meta.url);
const journalUrl = new URL('../../drizzle/meta/_journal.json', import.meta.url);

describe('O2C clean-baseline safety', () => {
  test('preserves the consolidated baseline before ordered additive migrations', async () => {
    const journal = JSON.parse(await readFile(journalUrl, 'utf8')) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    assert.deepEqual(journal.entries.map(({ idx, tag }) => ({ idx, tag })), [
      { idx: 0, tag: '0000_flexible-baseline' },
      { idx: 1, tag: '0001_backfill_shipment_readiness' },
      { idx: 2, tag: '0002_carrier_readiness_authorities' },
      { idx: 3, tag: '0003_majestic_clea' },
    ]);
  });

  test('retains O2C identity fences as unique indexes', async () => {
    const baseline = await readFile(baselineUrl, 'utf8');
    assert.match(baseline, /CREATE UNIQUE INDEX "lift_pricing_port_type_state_dir_date_uniq"/);
    assert.match(baseline, /CREATE UNIQUE INDEX "advance_settlements_auto_offset_expense_uniq"/);
    assert.match(baseline, /CREATE UNIQUE INDEX "shipments_id_cargo_mode_uniq_idx"/);
  });

  test('stores lifecycle values as flexible text without CHECK or foreign-key ownership', async () => {
    const baseline = await readFile(baselineUrl, 'utf8');
    assert.match(baseline, /"status" text DEFAULT 'NEW'/);
    assert.match(baseline, /"lift_pricing_snapshot" jsonb/);
    assert.match(baseline, /"allocated_amount" numeric/);
    assert.doesNotMatch(baseline, /CREATE TYPE .* AS ENUM/i);
    assert.doesNotMatch(baseline, /FOREIGN KEY|REFERENCES\s+"|\bCHECK\s*\(/i);
  });
});

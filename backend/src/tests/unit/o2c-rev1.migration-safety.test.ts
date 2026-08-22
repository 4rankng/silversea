import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const baselineUrl = new URL('../../../drizzle/0000_flexible-baseline.sql', import.meta.url);
const journalUrl = new URL('../../../drizzle/meta/_journal.json', import.meta.url);
const terminalLabelsUrl = new URL('../../../drizzle/0026_rename-lach-huyen-terminal-labels.sql', import.meta.url);

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
      { idx: 4, tag: '0004_tranquil_chronomancer' },
      { idx: 5, tag: '0005_cus_container_customer_appointment' },
      { idx: 6, tag: '0006_backfill_cus_container_customer_appointment' },
      { idx: 7, tag: '0007_backfill_shipment_shipping_line' },
      { idx: 8, tag: '0008_fair_stephen_strange' },
      { idx: 9, tag: '0009_neat_doctor_octopus' },
      { idx: 10, tag: '0010_backfill-shipment-document-reference-invariant' },
      { idx: 11, tag: '0011_mean_vulture' },
      { idx: 12, tag: '0012_sharp_jack_power' },
      { idx: 13, tag: '0013_backfill-shipment-combined-flag' },
      { idx: 14, tag: '0014_add-master-data-short-names' },
      { idx: 15, tag: '0015_backfill-master-data-short-names' },
      { idx: 16, tag: '0016_require-master-data-short-names' },
      { idx: 17, tag: '0017_add-short-name-compat-defaults' },
      { idx: 18, tag: '0018_add-supplier-short-name' },
      { idx: 19, tag: '0019_backfill-supplier-short-name' },
      { idx: 20, tag: '0020_require-supplier-short-name' },
      { idx: 21, tag: '0021_add-dispatch-zone-classification' },
      { idx: 22, tag: '0022_backfill-dispatch-zone-classification' },
      { idx: 23, tag: '0023_merge-duplicate-lach-huyen-hict-port' },
      { idx: 24, tag: '0024_create-dispatch-zones' },
      { idx: 25, tag: '0025_add-container-operational-site' },
      { idx: 26, tag: '0026_rename-lach-huyen-terminal-labels' },
      { idx: 27, tag: '0027_backfill-fulfillment-classification-single' },
      { idx: 28, tag: '0028_require-fulfillment-classification' },
      { idx: 29, tag: '0029_correct-lcl-fulfillment-classification' },
      { idx: 30, tag: '0030_enforce-lcl-fulfillment-classification' },
      { idx: 31, tag: '0031_fcl-container-route-authority' },
      { idx: 32, tag: '0032_add-factory-route' },
      { idx: 33, tag: '0033_backfill-legacy-shipment-cargo-mode' },
    ]);
  });

  test('renames only active Lạch Huyện terminal labels without moving port rows', async () => {
    const terminalLabels = await readFile(terminalLabelsUrl, 'utf8');
    assert.match(terminalLabels, /UPDATE "ports"/);
    assert.match(terminalLabels, /"deleted_at" IS NULL/);
    assert.match(terminalLabels, /'HICT'[\s\S]*'TC - HICT'/);
    assert.match(terminalLabels, /'HTIT'[\s\S]*'TIL - HTIT'/);
    assert.match(terminalLabels, /'HHIT'[\s\S]*'Hateco - HHIT'/);
    assert.doesNotMatch(terminalLabels, /\b(?:DELETE|INSERT|ALTER TABLE)\b/i);
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

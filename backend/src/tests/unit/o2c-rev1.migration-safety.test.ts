import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertJournalInvariants, readJournal } from '../helpers/journal-invariants';

const baselineUrl = new URL('../../../drizzle/0000_flexible-baseline.sql', import.meta.url);
const terminalLabelsUrl = new URL('../../../drizzle/0026_rename-lach-huyen-terminal-labels.sql', import.meta.url);
const legacyCargoModeUrl = new URL('../../../drizzle/0033_backfill-legacy-shipment-cargo-mode.sql', import.meta.url);

describe('O2C clean-baseline safety', () => {
  test('preserves the consolidated baseline before ordered additive migrations', async () => {
    // Structural journal invariants (contiguity, append-only ordering, tag↔file
    // existence, genesis tag, count floor) — new migrations need no test edits.
    await assertJournalInvariants(await readJournal(), 37);
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

  test('classifies only legacy NULL shipments that already own containers', async () => {
    const legacyCargoMode = await readFile(legacyCargoModeUrl, 'utf8');
    assert.match(legacyCargoMode, /SET "cargo_mode" = 'FCL'/);
    assert.match(legacyCargoMode, /EXISTS \([\s\S]*FROM "shipment_containers"/);
    assert.doesNotMatch(legacyCargoMode, /SET "cargo_mode" = 'LCL'/);
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

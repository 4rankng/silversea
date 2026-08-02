import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../../drizzle/0002_o2c_rev1_extensions.sql', import.meta.url);
const lifecycleMigrationUrl = new URL('../../drizzle/0005_sloppy_hulk.sql', import.meta.url);
const liftSnapshotMigrationUrl = new URL('../../drizzle/0006_lift_pricing_snapshot.sql', import.meta.url);
const advanceAllocationMigrationUrl = new URL('../../drizzle/0007_o2c_advance_partial_allocation.sql', import.meta.url);
const activeShipmentBackfillUrl = new URL('../../drizzle/0008_o2c_active_shipment_backfill.sql', import.meta.url);
const journalUrl = new URL('../../drizzle/meta/_journal.json', import.meta.url);

describe('O2C rev1 upgrade migration safety', () => {
  test('guards cargo_state backfill for deployed baselines that never had the column', async () => {
    const migration = await readFile(migrationUrl, 'utf8');

    assert.match(migration, /information_schema\.columns/i);
    assert.match(migration, /column_name\s*=\s*'cargo_state'/i);
    assert.match(migration, /EXECUTE\s+'UPDATE\s+"lift_pricing"/i);
    assert.ok(
      migration.indexOf("column_name = 'cargo_state'") < migration.indexOf("EXECUTE 'UPDATE \"lift_pricing\""),
      'the existence preflight must precede the optional legacy backfill',
    );
  });

  test('checks duplicate matrix rows before creating the unique index', async () => {
    const migration = await readFile(migrationUrl, 'utf8');
    const duplicateCheck = migration.indexOf('HAVING count(*) > 1');
    const uniqueIndex = migration.indexOf('CREATE UNIQUE INDEX "lift_pricing_port_type_state_dir_date_uniq"');

    assert.ok(duplicateCheck >= 0, 'duplicate matrix preflight is missing');
    assert.ok(uniqueIndex > duplicateCheck, 'unique index must run after the duplicate preflight');
  });

  test('preserves the deployed 0005 identity and applies later O2C corrections forward-only', async () => {
    const [lifecycle, liftSnapshot, advanceAllocation, activeBackfill, journalText] = await Promise.all([
      readFile(lifecycleMigrationUrl, 'utf8'),
      readFile(liftSnapshotMigrationUrl, 'utf8'),
      readFile(advanceAllocationMigrationUrl, 'utf8'),
      readFile(activeShipmentBackfillUrl, 'utf8'),
      readFile(journalUrl, 'utf8'),
    ]);
    const journal = JSON.parse(journalText) as { entries: Array<{ idx: number; tag: string }> };

    assert.equal(journal.entries[5]?.tag, '0005_sloppy_hulk');
    assert.deepEqual(journal.entries.slice(6).map((entry) => entry.tag), [
      '0006_lift_pricing_snapshot',
      '0007_o2c_advance_partial_allocation',
      '0008_o2c_active_shipment_backfill',
    ]);
    assert.match(lifecycle, /CREATE TYPE "public"\."shipment_status" AS ENUM\('NEW', 'DISPATCHED', 'IN_TRANSIT', 'PENDING_EXPENSE_APPROVAL', 'COMPLETED', 'CANCELED'\)/);
    assert.match(liftSnapshot, /ADD COLUMN "lift_pricing_snapshot" jsonb/);
    assert.match(advanceAllocation, /ADD COLUMN "allocated_amount"/);
    assert.match(advanceAllocation, /auto_offset_expense_uniq/);
    assert.match(activeBackfill, /"shipments"\."status" = 'DISPATCHED'/);
    assert.match(activeBackfill, /"trips"\."status" = 'IN_TRANSIT'/);
    assert.match(activeBackfill, /SET "status" = 'IN_TRANSIT'/);
  });
});

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../../drizzle/0002_o2c_rev1_extensions.sql', import.meta.url);

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
});

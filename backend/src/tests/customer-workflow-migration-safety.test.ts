import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';

describe('customer workflow migration safety', () => {
  it('fails explicitly before adding the milestone uniqueness constraint when legacy duplicates exist', async () => {
    const migrationPath = path.resolve(process.cwd(), 'drizzle/0166_superb_molten_man.sql');
    const migration = await readFile(migrationPath, 'utf8');
    const preflightPosition = migration.indexOf(
      'Cannot create shipment_milestones_trip_type_uniq',
    );
    const uniqueIndexPosition = migration.indexOf(
      'CREATE UNIQUE INDEX "shipment_milestones_trip_type_uniq"',
    );

    assert.ok(preflightPosition >= 0, 'duplicate-data preflight must be present');
    assert.ok(uniqueIndexPosition >= 0, 'milestone uniqueness index must be present');
    assert.ok(
      preflightPosition < uniqueIndexPosition,
      'duplicate-data preflight must run before the uniqueness index is created',
    );
    assert.match(migration, /HAVING count\(\*\) > 1/);
    assert.match(migration, /will not delete operational history automatically/);
  });
});

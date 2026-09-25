import { describe, it } from 'node:test';
import { strict } from 'node:assert';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { QA_FIXTURE_REGISTRY, registryTables } from '../seed/qa-fixture-registry.js';
import { censusSurface, purgeSurface } from '../seed/purge-qa-fixtures.js';

describe('QA fixture purge', () => {
  it('registry integrity: unique tables, valid actions, guarded hard-deletes', () => {
    const tables = registryTables();
    strict.equal(new Set(tables).size, tables.length, 'duplicate registry table');
    const validActions = ['soft-delete', 'hard-delete', 'hard-delete-guarded', 'deactivate', 'deactivate-plus-soft-delete'];
    for (const surface of QA_FIXTURE_REGISTRY) {
      strict.ok(surface.predicate.includes("ILIKE 'QA%'"), `predicate not QA-gated: ${surface.table}`);
      strict.ok(validActions.includes(surface.action), `invalid action: ${surface.table}`);
      if (surface.action === 'hard-delete-guarded') {
        strict.ok(surface.guards.length > 0 || surface.selfGuard, `guarded action without guard mechanism: ${surface.table}`);
      }
    }
  });

  it('purges QA rows and spares real-named rows (customers + suppliers), idempotent', async () => {
    const suffix = Date.now() % 1000000;
    const qaCust = `QAPURGE-TEST-CUST-${suffix}`;
    const realCust = `Khách hàng thật kiểm thử purge ${suffix}`;
    const qaSupp = `QAPURGE-TEST-SUPP-${suffix}`;
    const realSupp = `Nhà cung cấp thật kiểm thử purge ${suffix}`;
    await db.execute(sql.raw(`INSERT INTO customers (name) VALUES ('${qaCust}'), ('${realCust}')`));
    await db.execute(sql.raw(`INSERT INTO suppliers (name) VALUES ('${qaSupp}'), ('${realSupp}')`));

    const customers = QA_FIXTURE_REGISTRY.find((surface) => surface.table === 'customers');
    const suppliers = QA_FIXTURE_REGISTRY.find((surface) => surface.table === 'suppliers');
    strict.ok(customers && suppliers);

    strict.ok(await censusSurface(customers) >= 1, 'QA customer visible to census');
    strict.ok(await censusSurface(suppliers) >= 1, 'QA supplier visible to census');

    const custResult = await purgeSurface(customers, false);
    strict.ok(custResult.deleted >= 1, 'purge removed at least the QA test customer');
    const suppResult = await purgeSurface(suppliers, false);
    strict.ok(suppResult.deleted >= 1, 'purge removed at least the QA test supplier');

    const survivors = await db.execute(sql.raw(`SELECT name FROM customers WHERE name IN ('${qaCust}', '${realCust}') AND deleted_at IS NULL`));
    const list = Array.isArray(survivors) ? survivors : (survivors as { rows: Array<{ name: string }> }).rows;
    const names = list.map((row) => row.name);
    strict.deepEqual(names, [realCust], 'real customer must survive the purge');

    const reRun = await purgeSurface(customers, false);
    strict.equal(reRun.deleted, 0, 'idempotent re-run deletes nothing');

    await db.execute(sql.raw(`DELETE FROM customers WHERE name = '${realCust}'`));
    await db.execute(sql.raw(`DELETE FROM suppliers WHERE name = '${realSupp}'`));
  });
});

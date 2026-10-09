import { describe, it } from 'node:test';
import { strict } from 'node:assert';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { QA_FIXTURE_REGISTRY, registryTables } from '../seed/qa-fixture-registry.js';
import { censusSurface, purgeSurface } from '../seed/purge-qa-fixtures.js';

describe('QA fixture purge', () => {
  it('registry integrity: unique tables, valid actions, guarded hard-deletes', () => {
    const tables = registryTables();
    const pairs = QA_FIXTURE_REGISTRY.map((surface) => `${surface.table}:${surface.action}`);
    strict.equal(new Set(pairs).size, pairs.length, 'duplicate registry table+action pair');
    for (const [index, surface] of QA_FIXTURE_REGISTRY.entries()) {
      const firstAt = tables.indexOf(surface.table);
      if (surface.action === 'scrub') {
        strict.equal(firstAt, index - 1 >= 0 && QA_FIXTURE_REGISTRY[index - 1]!.table === surface.table ? index - 1 : firstAt, 'scrub stage must directly follow the row stage of its table');
      }
    }
    const validActions = ['soft-delete', 'hard-delete', 'hard-delete-guarded', 'deactivate', 'deactivate-plus-soft-delete', 'scrub'];
    for (const surface of QA_FIXTURE_REGISTRY) {
      const gated = surface.predicate.includes("ILIKE 'QA%'")
        || surface.predicate.includes("ILIKE '%QA0922-%'")
        || (surface.action === 'scrub' && surface.predicate.includes("ILIKE '%QA%'"));
      strict.ok(gated, `predicate not QA-gated: ${surface.table}`);
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

  it('purges FB-061 surfaces: distributions, penalty_reasons (Card 091026225810)', async () => {
    const suffix = Date.now() % 1000000;
    const qaPartner = `QA-118 dbapi truck partner ${suffix}`;
    const realPartner = `Đối tác đầu tư ${suffix}`;
    const qaReason = `QA AUDIT 0914 - staging only ${suffix}`;
    const realReason = `Lý do vi phạm ${suffix}`;

    await db.execute(sql.raw(`INSERT INTO distributions (quarter, year, partner_name, amount) VALUES (3, 2026, '${qaPartner}', 1500000), (3, 2026, '${realPartner}', 2000000)`));
    await db.execute(sql.raw(`INSERT INTO penalty_reasons (reason_text, default_amount) VALUES ('${qaReason}', 60000), ('${realReason}', 100000)`));

    const distSurface = QA_FIXTURE_REGISTRY.find((s) => s.table === 'distributions')!;
    const penSurface = QA_FIXTURE_REGISTRY.find((s) => s.table === 'penalty_reasons')!;
    strict.ok(distSurface && penSurface);

    strict.ok(await censusSurface(distSurface) >= 1);
    strict.ok(await censusSurface(penSurface) >= 1);

    await purgeSurface(distSurface, false);
    await purgeSurface(penSurface, false);

    const distSurvivors = await db.execute(sql.raw(`SELECT partner_name FROM distributions WHERE partner_name IN ('${qaPartner}', '${realPartner}')`));
    const distNames = (Array.isArray(distSurvivors) ? distSurvivors : (distSurvivors as { rows: Array<{ partner_name: string }> }).rows).map((r) => r.partner_name);
    strict.deepEqual(distNames, [realPartner]);

    const penSurvivors = await db.execute(sql.raw(`SELECT reason_text FROM penalty_reasons WHERE reason_text IN ('${qaReason}', '${realReason}') AND deleted_at IS NULL`));
    const penNames = (Array.isArray(penSurvivors) ? penSurvivors : (penSurvivors as { rows: Array<{ reason_text: string }> }).rows).map((r) => r.reason_text);
    strict.deepEqual(penNames, [realReason]);

    await db.execute(sql.raw(`DELETE FROM distributions WHERE partner_name = '${realPartner}'`));
    await db.execute(sql.raw(`DELETE FROM penalty_reasons WHERE reason_text IN ('${realReason}', '${qaReason}')`));
  });
});

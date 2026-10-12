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

  // Card 111026105610 (FB-061 round 14): QA rows surfaced in two positions the
  // original fix never covered — business_units had no registry surface at all,
  // and the FB-080 rung fixtures do not carry a QA prefix so they escaped the
  // shipments scrub predicate.
  it('deactivates QA business units and spares the real one (FB-061 round 14)', async () => {
    const suffix = Date.now() % 1000000;
    const qaUnit = `QA Audit Unit ${suffix}`;
    const realUnit = `Đơn vị thật ${suffix}`;

    await db.execute(sql.raw(`INSERT INTO business_units (code, name, status) VALUES ('QA${suffix}', '${qaUnit}', 'ACTIVE'), ('REAL${suffix}', '${realUnit}', 'ACTIVE')`));

    const surface = QA_FIXTURE_REGISTRY.find((s) => s.table === 'business_units');
    strict.ok(surface, 'business_units must be a registered QA fixture surface');
    strict.equal(surface!.action, 'deactivate');
    strict.ok(await censusSurface(surface!) >= 1);

    await purgeSurface(surface!, false);

    const after = await db.execute(sql.raw(`SELECT name, status FROM business_units WHERE name IN ('${qaUnit}', '${realUnit}')`));
    const rows = (Array.isArray(after) ? after : (after as { rows: Array<{ name: string; status: string }> }).rows);
    const byName = new Map(rows.map((r) => [r.name, r.status]));
    // The QA unit is deactivated in place — its id stays valid for the
    // user_business_unit_links rows that still point at it.
    strict.equal(byName.get(qaUnit), 'INACTIVE');
    strict.equal(byName.get(realUnit), 'ACTIVE');

    await db.execute(sql.raw(`DELETE FROM business_units WHERE name IN ('${qaUnit}', '${realUnit}')`));
  });

  it('scrubs the FB-080 rung fixture family while sparing a real factory name (FB-061 round 14)', async () => {
    const suffix = Date.now() % 1000000;
    const qaBl = `FB080-RUNG-${suffix}`;
    const realFactory = `Nhà máy thật ${suffix}`;

    await db.execute(sql.raw(`INSERT INTO shipments (bl_number, factory_name) VALUES ('${qaBl}', 'FB-080 rung minimal ${suffix}'), ('BL-REAL-${suffix}', '${realFactory}')`));

    const surface = QA_FIXTURE_REGISTRY.find((s) => s.table === 'shipments' && s.action === 'scrub');
    strict.ok(surface, 'shipments scrub surface must exist');
    strict.ok(await censusSurface(surface!) >= 1);

    await purgeSurface(surface!, false);

    const after = await db.execute(sql.raw(`SELECT bl_number, factory_name FROM shipments WHERE bl_number IN ('${qaBl}', 'BL-REAL-${suffix}')`));
    const rows = (Array.isArray(after) ? after : (after as { rows: Array<{ bl_number: string; factory_name: string | null }> }).rows);
    const byBl = new Map(rows.map((r) => [r.bl_number, r.factory_name]));
    strict.equal(byBl.get(qaBl), null, 'FB-080 rung factory name must be scrubbed');
    strict.equal(byBl.get(`BL-REAL-${suffix}`), realFactory, 'real factory name must survive');

    await db.execute(sql.raw(`DELETE FROM shipments WHERE bl_number IN ('${qaBl}', 'BL-REAL-${suffix}')`));
  });

  // FB-061 round 16 (card 121026185570): staging still lists the QA-seeded
  // fuel invoice QA0915-FI-001 on the payables fuel-invoice surface — the
  // registry never covered fuel_invoices and the fuel-invoice API has no
  // delete, so the class had no sanctioned purge. Register it children-first:
  // allocations and period adjustments go before the invoice they hang off.
  it('purges QA fuel invoices and their allocations, spares real PL- invoices (FB-061 round 16)', async () => {
    const suffix = Date.now() % 1000000;
    const qaNumber = `QA0915-FI-${suffix}`;
    const realNumber = `PL-2026-${String(suffix).padStart(7, '0')}`;

    const idRowsOf = async (query: string): Promise<Array<Record<string, unknown>>> => {
      const result = await db.execute(sql.raw(query));
      return Array.isArray(result) ? result : (result as { rows: Array<Record<string, unknown>> }).rows;
    };

    const [anchor] = await idRowsOf(`SELECT (SELECT min(id) FROM suppliers WHERE deleted_at IS NULL) AS supplier_id, (SELECT min(id) FROM trips) AS trip_id`);
    const supplierId = Number(anchor!.supplier_id);
    const tripId = Number(anchor!.trip_id);

    const invoiceSurfaces = QA_FIXTURE_REGISTRY.filter((s) => s.table === 'fuel_invoices');
    const allocationSurface = QA_FIXTURE_REGISTRY.find((s) => s.table === 'fuel_invoice_allocations');
    const adjustmentSurface = QA_FIXTURE_REGISTRY.find((s) => s.table === 'fuel_period_adjustments');
    strict.ok(invoiceSurfaces.length === 1 && allocationSurface && adjustmentSurface, 'fuel-invoice surfaces must be registered children-first');

    const inserted = await idRowsOf(`
      INSERT INTO fuel_invoices (supplier_id, invoice_number, invoice_date, total_liters, unit_price, total_amount, note)
      VALUES (${supplierId}, '${qaNumber}', CURRENT_DATE, 10, 22000, 220000, 'QA seed fuel invoice purge test'),
             (${supplierId}, '${realNumber}', CURRENT_DATE, 20, 23000, 460000, 'Hóa đơn xăng dầu thật')
      RETURNING id, invoice_number`);
    const qaInvoiceId = Number(inserted.find((r) => r.invoice_number === qaNumber)!.id);

    await db.execute(sql.raw(`
      INSERT INTO fuel_invoice_allocations (fuel_invoice_id, trip_id, voucher_reference, voucher_date, liters, amount)
      VALUES (${qaInvoiceId}, ${tripId}, 'QA-VCH-${suffix}', CURRENT_DATE, 10, 220000)`));

    strict.ok(await censusSurface(allocationSurface!) >= 1, 'QA allocation visible to census');
    strict.ok(await censusSurface(invoiceSurfaces[0]!) >= 1, 'QA invoice visible to census');

    // Children first, then the guarded parent — registry order.
    await purgeSurface(allocationSurface!, false);
    await purgeSurface(adjustmentSurface!, false);
    await purgeSurface(invoiceSurfaces[0]!, false);

    const after = await idRowsOf(`SELECT invoice_number FROM fuel_invoices WHERE invoice_number IN ('${qaNumber}', '${realNumber}')`);
    strict.deepEqual(after.map((r) => r.invoice_number), [realNumber], 'QA invoice purged, real PL- invoice survives');
    const allocationsLeft = await idRowsOf(`SELECT 1 AS hit FROM fuel_invoice_allocations WHERE fuel_invoice_id = ${qaInvoiceId}`);
    strict.equal(allocationsLeft.length, 0, 'QA invoice allocation purged with its parent');

    // The parent guard must refuse a lone run while a child still points at
    // the invoice, so an out-of-order purge can never orphan the FK.
    const guarded = await idRowsOf(`
      INSERT INTO fuel_invoices (supplier_id, invoice_number, invoice_date, total_liters, unit_price, total_amount, note)
      VALUES (${supplierId}, 'QA-GUARD-${suffix}', CURRENT_DATE, 5, 22000, 110000, 'QA guard probe') RETURNING id`);
    const guardedId = Number(guarded[0]!.id);
    await db.execute(sql.raw(`
      INSERT INTO fuel_invoice_allocations (fuel_invoice_id, trip_id, voucher_reference, voucher_date, liters, amount)
      VALUES (${guardedId}, ${tripId}, 'QA-VCH-G-${suffix}', CURRENT_DATE, 5, 110000)`));
    const loneRun = await purgeSurface(invoiceSurfaces[0]!, false);
    strict.equal(loneRun.deleted, 0, 'guarded invoice is skipped, not deleted');
    strict.ok(loneRun.skipped >= 1, 'guard skip is reported');

    await db.execute(sql.raw(`DELETE FROM fuel_invoice_allocations WHERE fuel_invoice_id IN (${qaInvoiceId}, ${guardedId})`));
    await db.execute(sql.raw(`DELETE FROM fuel_invoices WHERE invoice_number IN ('${qaNumber}', '${realNumber}', 'QA-GUARD-${suffix}')`));
  });
});

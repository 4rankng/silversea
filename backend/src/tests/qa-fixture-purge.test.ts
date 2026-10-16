import { describe, it } from 'node:test';
import { strict } from 'node:assert';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { QA_FIXTURE_REGISTRY, registryTables } from '../seed/qa-fixture-registry.js';
import { censusSurface, censusVisible, purgeSurface } from '../seed/purge-qa-fixtures.js';

/** `db.execute` returns the row array in some driver modes and `{ rows }` in
 *  others; every case in this suite reads both shapes. One validated boundary
 *  beats repeating an unchecked cast at each read. */
function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  if (result && typeof result === 'object' && 'rows' in result) {
    const rows = (result as { rows: unknown }).rows;
    if (Array.isArray(rows)) return rows as Array<Record<string, unknown>>;
  }
  throw new Error('unexpected db.execute result shape');
}

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
        || surface.predicate.includes("ILIKE '%QA-W1-%'")
        || surface.predicate.includes('year = 2099')
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
    strict.ok(invoiceSurfaces.length === 1 && allocationSurface && adjustmentSurface, 'fuel-invoice surfaces must be registered');
    const registryOrder = QA_FIXTURE_REGISTRY.map((s) => s.table);
    strict.ok(
      registryOrder.indexOf('fuel_invoice_allocations') < registryOrder.indexOf('fuel_invoices') &&
        registryOrder.indexOf('fuel_period_adjustments') < registryOrder.indexOf('fuel_invoices'),
      'fuel-invoice children (allocations, adjustments) must purge before their parent invoices',
    );

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

  // Ticket "QAC1 KH CLOSE 0919" (2026-10-14, FB-061 cousin): the QA close
  // rung authored DEBIT_NOTE billing_documents for a QA-named customer and no
  // registry surface existed, so the customer's name stayed visible on the
  // debit-note views after every purge. The dispatch zone followed the same
  // escape (QA-named label in the pickers).
  it('soft-deletes QA debit notes, hard-deletes their lines, scrubs QA zone labels', async () => {
    const suffix = Date.now() % 1000000;
    const idRowsOf = async (query: string): Promise<Array<Record<string, unknown>>> => {
      const result = await db.execute(sql.raw(query));
      return Array.isArray(result) ? result : (result as { rows: Array<Record<string, unknown>> }).rows;
    };
    const qaEntity = `QAC1 KH CLOSE ${suffix}`;
    const realEntity = 'Khách hàng thật kiểm thử chứng từ';

    const docs = await db.execute(sql.raw(`
      INSERT INTO billing_documents (type, entity_type, entity_id, entity_name, range_from, range_to, note)
      VALUES ('DEBIT_NOTE', 'CUSTOMER', 0, '${qaEntity}', CURRENT_DATE, CURRENT_DATE, 'QA close rung probe'),
             ('DEBIT_NOTE', 'CUSTOMER', 0, '${realEntity}', CURRENT_DATE, CURRENT_DATE, NULL)
      RETURNING id`));
    const docRows = (Array.isArray(docs) ? docs : (docs as { rows: Array<{ id: number }> }).rows);
    const qaDocId = Number(docRows[0]!.id);
    const realDocId = Number(docRows[1]!.id);
    await db.execute(sql.raw(`
      INSERT INTO billing_document_lines (document_id, source_type, line_type, type_label, unit, description, base_amount)
      VALUES (${qaDocId}, 'ADHOC', 'FREIGHT', 'Cước vận tải (auto)', 'lần', 'Cước vận tải (auto) — lô QA${suffix}', 1000000)`,
    ));

    const zones = await db.execute(sql.raw(`
      INSERT INTO dispatch_zones (code, label, sort_order, is_active)
      VALUES ('QA${suffix}', 'QAC1 Vùng QA ${suffix}', 0, true), ('REAL${suffix}', 'Vùng thật ${suffix}', 1, true)
      RETURNING id, label`));
    const zoneRows = (Array.isArray(zones) ? zones : (zones as { rows: Array<{ id: number; label: string }> }).rows);

    const linesSurface = QA_FIXTURE_REGISTRY.find((s) => s.table === 'billing_document_lines');
    const docsSurface = QA_FIXTURE_REGISTRY.find((s) => s.table === 'billing_documents');
    const zoneSurface = QA_FIXTURE_REGISTRY.find((s) => s.table === 'dispatch_zones');
    strict.ok(linesSurface && docsSurface && zoneSurface);

    strict.ok(await censusSurface(docsSurface) >= 1, 'QA debit note visible to census');
    const linesResult = await purgeSurface(linesSurface, false);
    strict.ok(linesResult.deleted >= 1, 'QA document lines hard-deleted');
    const docsResult = await purgeSurface(docsSurface, false);
    strict.ok(docsResult.deleted >= 1, 'QA debit note soft-deleted');
    await purgeSurface(zoneSurface, false);

    const linesLeft = await idRowsOf(`SELECT 1 AS hit FROM billing_document_lines WHERE document_id = ${qaDocId}`);
    strict.equal(linesLeft.length, 0, 'QA line gone with the purge');
    const docState = await db.execute(sql.raw(`SELECT id, deleted_at FROM billing_documents WHERE id IN (${qaDocId}, ${realDocId})`));
    const docRowsAfter = (Array.isArray(docState) ? docState : (docState as { rows: Array<{ id: number; deleted_at: Date | null }> }).rows);
    strict.ok(docRowsAfter.find((row) => row.id === qaDocId)?.deleted_at != null, 'QA document soft-deleted, not destroyed');
    strict.ok(docRowsAfter.find((row) => row.id === realDocId)?.deleted_at == null, 'real-named document untouched');

    const zoneState = await db.execute(sql.raw(`SELECT id, label FROM dispatch_zones WHERE id IN (${zoneRows.map((row) => row.id).join(',')})`));
    const zoneRowsAfter = (Array.isArray(zoneState) ? zoneState : (zoneState as { rows: Array<{ id: number; label: string }> }).rows)
      .map((row) => ({ id: Number(row.id), label: row.label }))
      .sort((a, b) => a.id - b.id);
    strict.equal(zoneRowsAfter[0]!.label, 'Chưa xác định', 'QA zone label scrubbed in place');
    strict.equal(zoneRowsAfter[1]!.label, `Vùng thật ${suffix}`, 'real zone label untouched');

    await db.execute(sql.raw(`DELETE FROM billing_document_lines WHERE document_id IN (${qaDocId}, ${realDocId})`));
    await db.execute(sql.raw(`DELETE FROM billing_documents WHERE id IN (${qaDocId}, ${realDocId})`));
    await db.execute(sql.raw(`DELETE FROM dispatch_zones WHERE id IN (${zoneRows.map((row) => row.id).join(',')})`));
  });

  it('censusVisible and soft-delete parenthesize OR predicates — the deleted filter binds the whole predicate', async () => {
    const suffix = Date.now() % 1000000;
    const idRowsOf = async (query: string): Promise<Array<Record<string, unknown>>> => {
      const result = await db.execute(sql.raw(query));
      return Array.isArray(result) ? result : (result as { rows: Array<Record<string, unknown>> }).rows;
    };
    // Two rows match the OR predicate's FIRST branch (entity_name); one is
    // already soft-deleted. The unparenthesized census counted it as visible
    // (`A OR B AND deleted_at IS NULL` ≡ `A OR (B AND …)`) and a re-run
    // rewrote its deleted_at.
    const docs = await idRowsOf(`
      INSERT INTO billing_documents (type, entity_type, entity_id, entity_name, range_from, range_to, note)
      VALUES ('DEBIT_NOTE', 'CUSTOMER', 0, 'QAC1 OR-PROBE A ${suffix}', CURRENT_DATE, CURRENT_DATE, NULL),
             ('DEBIT_NOTE', 'CUSTOMER', 0, 'QAC1 OR-PROBE B ${suffix}', CURRENT_DATE, CURRENT_DATE, NULL)
      RETURNING id`);
    const docA = Number(docs[0]!.id);
    const docB = Number(docs[1]!.id);
    await db.execute(sql.raw(`UPDATE billing_documents SET deleted_at = now() WHERE id = ${docB}`));

    const surface = QA_FIXTURE_REGISTRY.find((s) => s.table === 'billing_documents')!;
    // Scope the census assertions to this run's rows — the shared dev DB
    // carries older soft-deleted QA documents that censusSurface would count.
    const scoped: typeof surface = { ...surface, predicate: `entity_name LIKE 'QAC1 OR-PROBE %${suffix}'` };
    strict.equal(await censusSurface(scoped), 2, 'identifier census counts soft-deleted rows by design');
    strict.equal(await censusVisible(scoped), 1, 'visibility census must hide soft-deleted rows across every OR branch');
    const before = await idRowsOf(`SELECT deleted_at FROM billing_documents WHERE id = ${docB}`);
    const stampBBefore = Number(before[0]!.deleted_at);

    const rerun = await purgeSurface(surface, false);
    strict.ok(rerun.deleted >= 1, 're-run soft-deletes only the still-visible row');
    const stamps = await idRowsOf(`SELECT id, deleted_at FROM billing_documents WHERE id IN (${docA}, ${docB})`);
    const stampA = stamps.find((row) => Number(row.id) === docA)!;
    const stampB = stamps.find((row) => Number(row.id) === docB)!;
    strict.ok(stampA.deleted_at != null, 'the visible row is soft-deleted by the rerun');
    strict.equal(Number(stampB.deleted_at), stampBBefore, 'already-deleted row keeps its original deleted_at');

    await db.execute(sql.raw(`DELETE FROM billing_documents WHERE id IN (${docA}, ${docB})`));
  });

  // FB-061 (card 141026012010): the Kiểm soát phơi phiếu board showed the
  // fixture class in its own vehicle columns — biển số '99T-99999' /
  // '51K-PROBE' and lái xe 'Test Driver R15'. Both project from tables the
  // registry never covered: `trip_carrier_info` (external carriers) and the
  // own-fleet `trucks` / `drivers`. These cases prove each new surface
  // catches its signature and spares a real fleet row.
it('purges QA external-carrier rows and spares a real carrier row (FB-061, card 141026012010)', async () => {
    const suffix = Date.now() % 1000000;
    const realPlate = `51K-${suffix}`;
    // trip_carrier_info is one row per trip, so the fixtures need three trips
    // that carry no carrier row yet.
    const free = rowsOf(await db.execute(sql.raw(`
      SELECT t.id FROM trips t LEFT JOIN trip_carrier_info ci ON ci.trip_id = t.id WHERE ci.id IS NULL ORDER BY t.id LIMIT 3`)))
      .map((row) => Number(row.id));
    strict.equal(free.length, 3, 'the purge suite needs three trips without a carrier row');

    await db.execute(sql.raw(`
      INSERT INTO trip_carrier_info (trip_id, carrier_type, external_entity_type, external_plate_number, external_driver_name)
      VALUES (${free[0]}, 'EXTERNAL', 'CUSTOMER', '99T-99999', 'Test Driver R15'),
             (${free[1]}, 'EXTERNAL', 'CUSTOMER', '51K-PROBE-${suffix}', 'Tài xế thật ${suffix}'),
             (${free[2]}, 'EXTERNAL', 'CUSTOMER', '${realPlate}', 'Tài xế thật ${suffix}')`));

    const surface = QA_FIXTURE_REGISTRY.find((s) => s.table === 'trip_carrier_info');
    strict.ok(surface, 'trip_carrier_info must be a registered QA fixture surface');
    strict.equal(surface!.action, 'hard-delete', 'the table has no deleted_at/status column');
    strict.ok(await censusSurface(surface!) >= 1, 'the probe plate must be a purge candidate');

    await purgeSurface(surface!, false);

    const left = rowsOf(await db.execute(sql.raw(
      `SELECT external_plate_number FROM trip_carrier_info WHERE trip_id IN (${free[0]}, ${free[1]}, ${free[2]})`,
    ))).map((row) => row.external_plate_number);
    strict.deepEqual(left, [realPlate], 'the card-reported probe plate and the probe family go; the real carrier row stays');

    await db.execute(sql.raw(`DELETE FROM trip_carrier_info WHERE trip_id IN (${free[0]}, ${free[1]}, ${free[2]})`));
  });

  it('soft-deletes QA probe trucks and drivers, sparing the real fleet (FB-061, card 141026012010)', async () => {
    const suffix = Date.now() % 1000000;
    const probePlate = '99T-99999';
    const probeFamilyPlate = `51K-PROBE-${suffix}`;
    const realPlate = `51K-${suffix}`;
    await db.execute(sql.raw(`INSERT INTO trucks (license_plate, status) VALUES ('${probePlate}', 'ACTIVE'), ('${probeFamilyPlate}', 'ACTIVE'), ('${realPlate}', 'ACTIVE')`));
    await db.execute(sql.raw(`INSERT INTO drivers (name, status) VALUES ('Test Driver R15', 'ACTIVE'), ('Tài xế thật ${suffix}', 'ACTIVE')`));

    for (const table of ['trucks', 'drivers']) {
      const surface = QA_FIXTURE_REGISTRY.find((s) => s.table === table);
      strict.ok(surface, `${table} must be a registered QA fixture surface`);
      strict.ok(await censusSurface(surface!) >= 1, `${table} probe rows must be purge candidates`);
      await purgeSurface(surface!, false);
    }

    const visibleTrucks = rowsOf(await db.execute(sql.raw(
      `SELECT license_plate FROM trucks WHERE license_plate IN ('${probePlate}', '${probeFamilyPlate}', '${realPlate}') AND deleted_at IS NULL`,
    ))).map((row) => row.license_plate);
    strict.deepEqual(visibleTrucks, [realPlate], 'both probe plates leave, the real fleet plate stays');

    const visibleDrivers = rowsOf(await db.execute(sql.raw(
      `SELECT name FROM drivers WHERE name IN ('Test Driver R15', 'Tài xế thật ${suffix}') AND deleted_at IS NULL`,
    ))).map((row) => row.name);
    strict.deepEqual(visibleDrivers, [`Tài xế thật ${suffix}`], 'only the probe driver is soft-deleted');

    await db.execute(sql.raw(`DELETE FROM trucks WHERE license_plate IN ('${probePlate}', '${probeFamilyPlate}', '${realPlate}')`));
    await db.execute(sql.raw(`DELETE FROM drivers WHERE name IN ('Test Driver R15', 'Tài xế thật ${suffix}')`));
  });

  // The board filters `shipments.deleted_at`, so a lot whose bill carries a
  // probe family must leave the board entirely — not merely be hidden from
  // the shipments list. The card quotes BL-QAKE-<timestamp> and E2E-*.
  it('soft-deletes probe bill families so the board stops rendering the lot (FB-061, card 141026012010)', async () => {
    const suffix = Date.now() % 1000000;
    const probeBl = `BL-QAKE-1789702634${suffix}`;
    const e2eBl = `E2E-${suffix}`;
    const realBl = `BL-REAL-${suffix}`;

    await db.execute(sql.raw(`INSERT INTO shipments (bl_number) VALUES ('${probeBl}'), ('${e2eBl}'), ('${realBl}')`));

    const surface = QA_FIXTURE_REGISTRY.find((s) => s.table === 'shipments' && s.action === 'soft-delete');
    strict.ok(surface, 'shipments soft-delete surface must exist');
    await purgeSurface(surface!, false);

    const deletedByBill = new Map(rowsOf(await db.execute(sql.raw(
      `SELECT bl_number, deleted_at FROM shipments WHERE bl_number IN ('${probeBl}', '${e2eBl}', '${realBl}')`,
    ))).map((row) => [row.bl_number, row.deleted_at]));
    strict.ok(deletedByBill.get(probeBl), 'the BL-QAKE lot must be soft-deleted');
    strict.ok(deletedByBill.get(e2eBl), 'the E2E- lot must be soft-deleted');
    strict.equal(deletedByBill.get(realBl), null, 'a real bill number must survive');

    await db.execute(sql.raw(`DELETE FROM shipments WHERE bl_number IN ('${probeBl}', '${e2eBl}', '${realBl}')`));
  });
});

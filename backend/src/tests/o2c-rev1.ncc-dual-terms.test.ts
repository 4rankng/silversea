import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, client } from '../db';
import * as s from '../db/schema';
import { insertTripComposite } from '../services/trip-composite.service';
import { resolveSupplierPaymentDueDate } from '../services/business-calendar.service';
import { LedgerService } from '../services/ledger.service';
import { disconnectRedis } from '../lib/redis';

/**
 * O2C rev1 §B0 — Phase 1: NCC dual payment terms.
 *
 * Verifies:
 *  1. `resolveSupplierPaymentDueDate` returns the correct term per `kind`
 *     (CHI_HO vs CUOC) and `null` when the supplier field is unset.
 *  2. `LedgerService.postTripCompletion` threads the supplier term into the
 *     VENDOR fuel-supplier posting (`FUEL_EXPENSE → CHI_HO`) and the CARRIER
 *     external-carrier posting (`EXTERNAL_CARRIER_COST → CUOC`) via
 *     `paymentTermDaysApplied` on the ledger row — previously always null.
 *
 * Pattern mirrors ledger.service.chiho.test.ts: real Postgres, clean up in
 * `after`.
 */

const createdSupplierIds: number[] = [];
const createdTripIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdLedgerTxnIds: number[] = [];

async function insertSupplier(overrides: Partial<typeof s.suppliers.$inferInsert> = {}): Promise<number> {
  const [row] = await db.insert(s.suppliers).values({
    name: `O2C-REV1-SUP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    status: 'ACTIVE',
    ...overrides,
  }).returning({ id: s.suppliers.id });
  createdSupplierIds.push(row.id);
  return row.id;
}

before(async () => {
  // Confirm the dev DB has the new columns. The migration
  // `0001_glossy_anthem.sql` (ALTER TABLE suppliers ADD chi_ho_due_days /
  // cuoc_due_days) must be applied before running this suite.
  const cols = await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'suppliers' AND column_name = 'chi_ho_due_days'
    LIMIT 1
  `);
  assert.ok(cols.length, 'suppliers.chi_ho_due_days missing — apply 0001_glossy_anthem.sql first');
});

after(async () => {
  if (createdLedgerTxnIds.length) {
    await db.delete(s.ledger).where(inArray(s.ledger.txnId, createdLedgerTxnIds));
  }
  if (createdTripIds.length) await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
  if (createdCustomerIds.length) await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
  if (createdRouteIds.length) await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
  if (createdCargoTypeIds.length) await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, createdCargoTypeIds));
  for (const id of createdSupplierIds) {
    await db.delete(s.suppliers).where(eq(s.suppliers.id, id));
  }
  await disconnectRedis();
  await client.end();
});

describe('O2C rev1 §B0 — NCC dual payment terms', () => {
  test('resolveSupplierPaymentDueDate returns the CHI_HO term when kind=CHI_HO', async () => {
    const supplierId = await insertSupplier({ chiHoDueDays: 15, cuocDueDays: 30 });
    const snap = await resolveSupplierPaymentDueDate(db, supplierId, 'CHI_HO', '2026-08-02');
    assert.ok(snap, 'CHI_HO snapshot should not be null when chiHoDueDays is set');
    assert.equal(snap!.paymentTermDays, 15);
  });

  test('resolveSupplierPaymentDueDate returns the CUOC term when kind=CUOC', async () => {
    const supplierId = await insertSupplier({ chiHoDueDays: 15, cuocDueDays: 30 });
    const snap = await resolveSupplierPaymentDueDate(db, supplierId, 'CUOC', '2026-08-02');
    assert.ok(snap, 'CUOC snapshot should not be null when cuocDueDays is set');
    assert.equal(snap!.paymentTermDays, 30);
  });

  test('resolveSupplierPaymentDueDate returns null when the requested kind is unset', async () => {
    // Supplier has only chiHoDueDays set; CUOC should be null.
    const supplierId = await insertSupplier({ chiHoDueDays: 15, cuocDueDays: null });
    const cuoc = await resolveSupplierPaymentDueDate(db, supplierId, 'CUOC', '2026-08-02');
    assert.equal(cuoc, null, 'CUOC must be null when cuocDueDays is unset');

    // And CHI_HO resolves normally on the same supplier.
    const chiHo = await resolveSupplierPaymentDueDate(db, supplierId, 'CHI_HO', '2026-08-02');
    assert.ok(chiHo);
    assert.equal(chiHo!.paymentTermDays, 15);
  });

  test('resolveSupplierPaymentDueDate returns null when both terms are unset', async () => {
    const supplierId = await insertSupplier({ chiHoDueDays: null, cuocDueDays: null });
    const chiHo = await resolveSupplierPaymentDueDate(db, supplierId, 'CHI_HO', '2026-08-02');
    const cuoc = await resolveSupplierPaymentDueDate(db, supplierId, 'CUOC', '2026-08-02');
    assert.equal(chiHo, null);
    assert.equal(cuoc, null);
  });

  test('resolveSupplierPaymentDueDate computes the due date from the basis date', async () => {
    const supplierId = await insertSupplier({ chiHoDueDays: 15 });
    const snap = await resolveSupplierPaymentDueDate(db, supplierId, 'CHI_HO', '2026-08-02');
    assert.ok(snap);
    // 2026-08-02 + 15 calendar days = 2026-08-17 (CALENDAR_DAY policy, no roll).
    assert.equal(snap!.originalDate, '2026-08-17');
    assert.equal(snap!.processingDate, '2026-08-17');
    assert.equal(snap!.policy, 'CALENDAR_DAY');
  });

  test('resolveSupplierPaymentDueDate throws for a non-existent supplier', async () => {
    await assert.rejects(
      () => resolveSupplierPaymentDueDate(db, 9_999_999, 'CHI_HO', '2026-08-02'),
      /Không tìm thấy nhà cung cấp/,
    );
  });

  test('LedgerService.postTripCompletion stamps paymentTermDaysApplied on the VENDOR fuel-supplier row from chiHoDueDays', async () => {
    // Minimal trip shape that drives postTripCompletion's fuel-supplier branch.
    // We only need the fuelSupplierId + totalFuelCost path; other branches are
    // zeroed out to isolate the assertion.
    const fuelSupplierId = await insertSupplier({ chiHoDueDays: 15, cuocDueDays: 30 });

    // We need a real trip row to satisfy the FK and the departureDate lookup.
    const [cargoType] = await db.insert(s.cargoTypes).values({
      name: `O2C-REV1-CT-${Date.now()}`,
      isBulk: false,
    }).returning({ id: s.cargoTypes.id });
    createdCargoTypeIds.push(cargoType.id);

    const [customer] = await db.insert(s.customers).values({
      name: `O2C-REV1-CUST-${Date.now()}`,
      paymentTermDays: 30,
    }).returning({ id: s.customers.id });
    createdCustomerIds.push(customer.id);

    const [route] = await db.insert(s.routes).values({
      name: `O2C-REV1-ROUTE-${Date.now()}`,
      distanceKm: 50,
    }).returning({ id: s.routes.id });
    createdRouteIds.push(route.id);

    const trip = await insertTripComposite(db, {
      tripCode: `O2C-${Date.now()}`,
      customerId: customer.id,
      routeId: route.id,
      cargoTypeId: cargoType.id,
      departureDate: '2026-08-02',
      carrierType: 'OWN',
      fuelSupplierId,
      totalFuelCost: '1000000',
      revenue: '0',           // zero out the customer-revenue branch
      driverSalary: '0',
      status: 'IN_TRANSIT',
    });
    createdTripIds.push(trip.id);
    createdLedgerTxnIds.push(trip.id);

    await db.transaction(async (tx) => {
      await LedgerService.postTripCompletion(tx, {
        id: trip.id,
        customerId: customer.id,
        driverId: null,
        carrierType: 'OWN',
        fuelSupplierId,
        externalEntityId: null,
        externalEntityType: null,
        externalFreightCost: null,
        revenue: '0',
        driverSalary: '0',
        totalFuelCost: '1000000',
        tripCode: trip.tripCode,
        departureDate: '2026-08-02',
        ancillaryFees: [],
      });
    });

    // The VENDOR fuel-supplier ledger row must now carry paymentTermDaysApplied = 15 (chi-hộ term).
    const [vendorRow] = await db.select().from(s.ledger).where(eq(s.ledger.txnId, trip.id));
    assert.ok(vendorRow, 'a ledger row should have been posted');
    assert.equal(vendorRow.entityType, 'VENDOR');
    assert.equal(vendorRow.entityId, fuelSupplierId);
    assert.equal(vendorRow.paymentTermDaysApplied, 15,
      'fuel-supplier VENDOR row must carry chiHoDueDays (15), was null before Phase 1');
  });

  test('external carrier payable resolves cuocDueDays through the explicit customer-supplier link', async () => {
    const supplierId = await insertSupplier({ chiHoDueDays: 15, cuocDueDays: 30 });
    const [carrier] = await db.insert(s.customers).values({
      name: `O2C-REV1-CARRIER-${Date.now()}`,
      isCarrier: true,
      linkedSupplierId: supplierId,
      paymentTermDays: 30,
    }).returning({ id: s.customers.id });
    createdCustomerIds.push(carrier.id);

    const [customer] = await db.insert(s.customers).values({
      name: `O2C-REV1-OWNER-${Date.now()}`,
      paymentTermDays: 30,
    }).returning({ id: s.customers.id });
    createdCustomerIds.push(customer.id);
    const [route] = await db.insert(s.routes).values({
      name: `O2C-REV1-CARRIER-ROUTE-${Date.now()}`,
      distanceKm: 50,
    }).returning({ id: s.routes.id });
    createdRouteIds.push(route.id);
    const [cargoType] = await db.insert(s.cargoTypes).values({
      name: `O2C-REV1-CARRIER-CARGO-${Date.now()}`,
      isBulk: false,
    }).returning({ id: s.cargoTypes.id });
    createdCargoTypeIds.push(cargoType.id);
    const trip = await insertTripComposite(db, {
      tripCode: `O2C-CARRIER-${Date.now()}`,
      customerId: customer.id,
      routeId: route.id,
      cargoTypeId: cargoType.id,
      departureDate: '2026-08-02',
      carrierType: 'EXTERNAL',
      externalEntityId: carrier.id,
      externalEntityType: 'CUSTOMER',
      externalFreightCost: '3500000',
      revenue: '0',
      driverSalary: '0',
      status: 'IN_TRANSIT',
    });
    createdTripIds.push(trip.id);
    createdLedgerTxnIds.push(trip.id);

    await db.transaction(tx => LedgerService.postTripCompletion(tx, {
      id: trip.id,
      customerId: customer.id,
      driverId: null,
      carrierType: 'EXTERNAL',
      externalEntityId: carrier.id,
      externalEntityType: 'CUSTOMER',
      externalFreightCost: '3500000',
      revenue: '0',
      driverSalary: '0',
      tripCode: trip.tripCode,
      departureDate: '2026-08-02',
      ancillaryFees: [],
    }));

    const [carrierRow] = await db.select().from(s.ledger).where(and(
      eq(s.ledger.txnId, trip.id),
      eq(s.ledger.entityType, 'CARRIER'),
    ));
    assert.equal(carrierRow?.paymentTermDaysApplied, 30);
  });
});

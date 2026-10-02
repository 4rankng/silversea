import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { recordIncidentalCost } from '../services/driver.service';
import { confirmAccountingExpenses } from '../services/expense-accounting-write.service';
import { ApiError } from '../errors';
import { DRIVER_LOT_COST_EXPENSE_TYPES, DriverIncidentalCostType, Role } from '@tingting/shared';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const TODAY = new Date().toISOString().slice(0, 10);

const cleanup: Array<() => Promise<void>> = [];
const track = (fn: () => Promise<void>) => cleanup.unshift(fn);

async function mkAccountant() {
  const [u] = await db.insert(s.users).values({
    username: `card6-${suffix}-${cleanup.length}-acct`, passwordHash: 'x', role: 'ACCOUNTANT',
  }).returning();
  track(async () => { await db.delete(s.users).where(eq(s.users.id, u.id)); });
  return u;
}

async function mkDriverTrip() {
  const [u] = await db.insert(s.users).values({
    username: `card6-${suffix}-${cleanup.length}`, passwordHash: 'x', role: 'DRIVER',
  }).returning();
  track(async () => { await db.delete(s.users).where(eq(s.users.id, u.id)); });
  const [d] = await db.insert(s.drivers).values({ name: 'card6 driver', userId: u.id }).returning();
  track(async () => { await db.delete(s.drivers).where(eq(s.drivers.id, d.id)); });
  const [customer] = await db.insert(s.customers).values({ name: `card6 cust ${suffix}-${cleanup.length}` }).returning();
  track(async () => { await db.delete(s.customers).where(eq(s.customers.id, customer.id)); });
  const [route] = await db.insert(s.routes).values({ name: `card6 route ${suffix}` }).returning();
  track(async () => { await db.delete(s.routes).where(eq(s.routes.id, route.id)); });
  const [cargoType] = await db.insert(s.cargoTypes).values({ name: `card6 cargo ${suffix}-${cleanup.length}` }).returning();
  track(async () => { await db.delete(s.cargoTypes).where(eq(s.cargoTypes.id, cargoType.id)); });
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'PENDING_DATE',
  }).returning();
  track(async () => { await db.delete(s.shipments).where(eq(s.shipments.id, shipment.id)); });
  const [trip] = await db.insert(s.trips).values({
    tripCode: `CARD6-${suffix}-${cleanup.length}`.slice(0, 50),
    driverId: d.id, shipmentId: shipment.id, customerId: customer.id, routeId: route.id, cargoTypeId: cargoType.id,
    status: 'IN_TRANSIT', departureDate: TODAY,
  }).returning();
  track(async () => { await db.delete(s.trips).where(eq(s.trips.id, trip.id)); });
  return { user: u, driver: d, shipment, trip };
}

describe('card 20260921_6 - driver lot-cost classification', () => {
  test('catalog ships pre-seeded with the card classes (AC4)', async () => {
    // Card 20260928_163: the invoiced side is the CANONICAL catalog — the
    // ops/chi-hộ codes plus LIFTING/LOWERING. The card-6 twins SANITATION and
    // STORAGE_FEE duplicated their display names (case QA-2026-09-25-01) and must
    // stay retired, or the Loại phí dropdown shows two identical labels again.
    const expected = DRIVER_LOT_COST_EXPENSE_TYPES;
    const rows = await db.select({
      code: s.forwarderExpenseTypes.code,
      name: s.forwarderExpenseTypes.name,
      requiresInvoice: s.forwarderExpenseTypes.requiresInvoice,
      status: s.forwarderExpenseTypes.status,
    }).from(s.forwarderExpenseTypes)
      .where(inArray(s.forwarderExpenseTypes.code, [...expected.map((type) => type.code), 'SANITATION', 'STORAGE_FEE']));
    assert.equal(rows.length, expected.length + 2, 'every family code plus the two retired twins');
    for (const { code, invoiced } of expected) {
      const row = rows.find((r) => r.code === code);
      assert.ok(row, `missing catalog row ${code}`);
      assert.equal(row.status, 'ACTIVE', `${code} must be ACTIVE`);
      assert.equal(row.requiresInvoice, invoiced, `${code} wrong class`);
    }
    for (const code of ['SANITATION', 'STORAGE_FEE']) {
      const twin = rows.find((r) => r.code === code);
      assert.ok(twin, `retired twin ${code} must keep its row for history`);
      assert.notEqual(twin.status, 'ACTIVE', `${code} is a duplicate display name — it must stay retired`);
    }
  });

  test('no two ACTIVE driver-family rows carry the same display name (card 20260928_164)', async () => {
    const family = [...DRIVER_LOT_COST_EXPENSE_TYPES.map((type) => type.code), 'SANITATION', 'STORAGE_FEE'];
    const rows = await db.select({ code: s.forwarderExpenseTypes.code, name: s.forwarderExpenseTypes.name })
      .from(s.forwarderExpenseTypes)
      .where(and(inArray(s.forwarderExpenseTypes.code, family), eq(s.forwarderExpenseTypes.status, 'ACTIVE')));
    const seen = new Map<string, string>();
    for (const row of rows) {
      const previous = seen.get(row.name);
      assert.equal(previous, undefined, `"${row.name}" is offered by both ${previous} and ${row.code}`);
      seen.set(row.name, row.code);
    }
  });

  test('invoiced type: invoice mandatory, charges customer, replay honors catalog ref (AC1/AC2)', async () => {
    const { user, driver, trip } = await mkDriverTrip();
    const body = {
      costType: DriverIncidentalCostType.OTHER, expenseTypeCode: 'FEE_CLEANING',
      amount: 250000, occurredAt: TODAY, invoiceNumber: 'card6-HD-1', invoiceDate: TODAY,
    };
    const { cost, replayed } = await recordIncidentalCost(trip.id, driver.id, body, user.id, `card6-key-${suffix}-inv`);
    track(async () => { await db.delete(s.driverIncidentalCosts).where(eq(s.driverIncidentalCosts.id, cost.id)); });
    assert.equal(replayed, false);
    const [source] = await db.select().from(s.expenseAccountingSources).where(and(
      eq(s.expenseAccountingSources.sourceKind, 'DRIVER'),
      eq(s.expenseAccountingSources.sourceId, cost.id)));
    track(async () => { await db.delete(s.expenseAccountingSources).where(eq(s.expenseAccountingSources.id, source.id)); });
    assert.ok(source, 'registry row must exist for shipment-linked trips');
    const [entryRow] = await db.select().from(s.driverIncidentalCosts).where(eq(s.driverIncidentalCosts.id, cost.id));
    assert.equal(entryRow.customerChargeAmount, '250000');
    assert.equal(entryRow.invoiceNumber, 'card6-HD-1');

    const replay = await recordIncidentalCost(trip.id, driver.id, body, user.id, `card6-key-${suffix}-inv`);
    assert.equal(replay.replayed, true);
    assert.equal(replay.cost.id, cost.id);
  });

  test('invoiced without invoice number is rejected (AC1)', async () => {
    const { user, driver, trip } = await mkDriverTrip();
    await recordIncidentalCost(trip.id, driver.id, {
      costType: DriverIncidentalCostType.OTHER, expenseTypeCode: 'FEE_CLEANING',
      amount: 250000, occurredAt: TODAY,
    }, user.id, `card6-key-${suffix}-noinv`).then(
      () => { throw new Error('expected 400 rejection'); },
      (err: unknown) => {
        assert.ok(err instanceof ApiError, `expected ApiError, got ${(err as Error).name}`);
        assert.equal((err as ApiError).statusCode, 400);
        assert.match((err as ApiError).message, /số hóa đơn/);
      },
    );
  });

  test('no-invoice type never charges, whatever the driver typed (AC3)', async () => {
    const { user, driver, trip } = await mkDriverTrip();
    const { cost } = await recordIncidentalCost(trip.id, driver.id, {
      costType: DriverIncidentalCostType.OTHER, expenseTypeCode: 'WAREHOUSE_LABOR',
      amount: 120000, occurredAt: TODAY, invoiceNumber: 'card6-HD-should-be-dropped', invoiceDate: TODAY,
    }, user.id, `card6-key-${suffix}-noinvoice`);
    track(async () => { await db.delete(s.driverIncidentalCosts).where(eq(s.driverIncidentalCosts.id, cost.id)); });
    const [entryRow] = await db.select().from(s.driverIncidentalCosts).where(eq(s.driverIncidentalCosts.id, cost.id));
    assert.equal(entryRow.customerChargeAmount, '0');
    assert.equal(entryRow.invoiceNumber, null);
  });

  test('enum-only entry without catalog ref keeps the legacy heuristic', async () => {
    const { user, driver, trip } = await mkDriverTrip();
    const withInvoice = await recordIncidentalCost(trip.id, driver.id, {
      costType: DriverIncidentalCostType.OTHER, amount: 60000, occurredAt: TODAY,
      invoiceNumber: 'card6-HD-legacy', invoiceDate: TODAY,
    }, user.id, `card6-key-${suffix}-legacy-1`);
    track(async () => { await db.delete(s.driverIncidentalCosts).where(eq(s.driverIncidentalCosts.id, withInvoice.cost.id)); });
    const [withInvoiceRow] = await db.select().from(s.driverIncidentalCosts).where(eq(s.driverIncidentalCosts.id, withInvoice.cost.id));
    assert.equal(withInvoiceRow.customerChargeAmount, '60000');
    const withoutInvoice = await recordIncidentalCost(trip.id, driver.id, {
      costType: DriverIncidentalCostType.TOLL, amount: 40000, occurredAt: TODAY,
    }, user.id, `card6-key-${suffix}-legacy-2`);
    track(async () => { await db.delete(s.driverIncidentalCosts).where(eq(s.driverIncidentalCosts.id, withoutInvoice.cost.id)); });
    const [withoutInvoiceRow] = await db.select().from(s.driverIncidentalCosts).where(eq(s.driverIncidentalCosts.id, withoutInvoice.cost.id));
    assert.equal(withoutInvoiceRow.customerChargeAmount, '0');
  });

  test('pre-confirm: no receivable projection; after accountant confirm it carries charge + invoice (AC2/AC5)', async () => {
    const { user, driver, trip } = await mkDriverTrip();
    const accountant = await mkAccountant();
    const { cost } = await recordIncidentalCost(trip.id, driver.id, {
      costType: DriverIncidentalCostType.OTHER, expenseTypeCode: 'FEE_CLEANING',
      amount: 250000, occurredAt: TODAY, invoiceNumber: 'card6-HD-2', invoiceDate: TODAY,
    }, user.id, `card6-key-${suffix}-confirm`);
    track(async () => { await db.delete(s.driverIncidentalCosts).where(eq(s.driverIncidentalCosts.id, cost.id)); });
    const [source] = await db.select().from(s.expenseAccountingSources).where(and(
      eq(s.expenseAccountingSources.sourceKind, 'DRIVER'),
      eq(s.expenseAccountingSources.sourceId, cost.id)));
    track(async () => { await db.delete(s.expenseAccountingSources).where(eq(s.expenseAccountingSources.id, source.id)); });
    assert.equal(source.confirmedAt, null);
    const preConfirm = await db.select({ id: s.tripExpenses.id }).from(s.tripExpenses)
      .where(and(eq(s.tripExpenses.tripId, trip.id), eq(s.tripExpenses.feeName, 'Phí vệ sinh')));
    assert.equal(preConfirm.length, 0);

    await db.transaction(async (tx) => {
      await confirmAccountingExpenses(tx, { userId: accountant.id, role: Role.ACCOUNTANT },
        [{ sourceKind: 'DRIVER', sourceId: cost.id, expectedVersion: source.version }]);
    });
    const [projection] = await db.select().from(s.tripExpenses)
      .where(and(eq(s.tripExpenses.tripId, trip.id), eq(s.tripExpenses.feeName, 'Phí vệ sinh')));
    track(async () => { await db.delete(s.tripExpenses).where(eq(s.tripExpenses.id, projection.id)); });
    assert.ok(projection, 'confirm must project the receivable');
    assert.equal(projection.sellAmount, '250000');
    assert.equal(projection.invoiceNumber, 'card6-HD-2');
  });
});

describe('card 20260928_163 — nâng / hạ / phí khác có HĐ ride ONE table (AC4)', () => {
  // The card asks for the three lot-cost kinds to run through a single
  // table-driven test rather than three hand-written ones: the classification is
  // the catalog row, so the only per-kind difference is WHICH row (AC3), and the
  // behaviour — invoice mandatory, charge = amount, receivable only after the
  // accountant ticks — must be identical for all three.
  const KINDS = [
    { kind: 'nâng', code: 'LIFTING', feeName: 'Phí nâng container' },
    { kind: 'hạ', code: 'LOWERING', feeName: 'Phí hạ container' },
    { kind: 'phí khác có HĐ', code: 'FEE_CLEANING', feeName: 'Phí vệ sinh' },
  ] as const;

  for (const { kind, code, feeName } of KINDS) {
    test(`${kind} (${code}): bắt buộc số HĐ, thu khách = số tiền, chỉ vào phải thu sau khi KT xác nhận`, async () => {
      const { user, driver, trip } = await mkDriverTrip();
      const accountant = await mkAccountant();

      await recordIncidentalCost(trip.id, driver.id, {
        costType: DriverIncidentalCostType.OTHER, expenseTypeCode: code, amount: 300000, occurredAt: TODAY,
      }, user.id, `card163-${suffix}-${code}-noinv`).then(
        () => { throw new Error(`${kind}: expected the invoice number to be mandatory`); },
        (err: unknown) => {
          assert.ok(err instanceof ApiError, `${kind}: expected ApiError, got ${(err as Error).name}`);
          assert.match((err as ApiError).message, /số hóa đơn/);
        },
      );

      const { cost } = await recordIncidentalCost(trip.id, driver.id, {
        costType: DriverIncidentalCostType.OTHER, expenseTypeCode: code, amount: 300000, occurredAt: TODAY,
        invoiceNumber: `card163-HD-${code}`, invoiceDate: TODAY,
      }, user.id, `card163-${suffix}-${code}`);
      track(async () => { await db.delete(s.driverIncidentalCosts).where(eq(s.driverIncidentalCosts.id, cost.id)); });

      const [entryRow] = await db.select().from(s.driverIncidentalCosts).where(eq(s.driverIncidentalCosts.id, cost.id));
      assert.equal(entryRow.expenseTypeCode, code, `${kind}: the catalog ref is stored, not a free-typed class`);
      assert.equal(entryRow.customerChargeAmount, '300000', `${kind}: an invoiced row charges the customer`);

      const [source] = await db.select().from(s.expenseAccountingSources).where(and(
        eq(s.expenseAccountingSources.sourceKind, 'DRIVER'),
        eq(s.expenseAccountingSources.sourceId, cost.id)));
      track(async () => { await db.delete(s.expenseAccountingSources).where(eq(s.expenseAccountingSources.id, source.id)); });
      const preConfirm = await db.select({ id: s.tripExpenses.id }).from(s.tripExpenses)
        .where(and(eq(s.tripExpenses.tripId, trip.id), eq(s.tripExpenses.feeName, feeName)));
      assert.equal(preConfirm.length, 0, `${kind}: chưa xác nhận thì chưa vào phải thu`);

      await db.transaction(async (tx) => {
        await confirmAccountingExpenses(tx, { userId: accountant.id, role: Role.ACCOUNTANT },
          [{ sourceKind: 'DRIVER', sourceId: cost.id, expectedVersion: source.version }]);
      });
      const [projection] = await db.select().from(s.tripExpenses)
        .where(and(eq(s.tripExpenses.tripId, trip.id), eq(s.tripExpenses.feeName, feeName)));
      track(async () => { await db.delete(s.tripExpenses).where(eq(s.tripExpenses.id, projection.id)); });
      assert.ok(projection, `${kind}: KT xác nhận thì khoản vào phải thu`);
      assert.equal(projection.sellAmount, '300000', `${kind}: phải thu = số tiền`);
      assert.equal(projection.invoiceNumber, `card163-HD-${code}`, `${kind}: số HĐ đi kèm khoản phải thu`);
    });
  }
});

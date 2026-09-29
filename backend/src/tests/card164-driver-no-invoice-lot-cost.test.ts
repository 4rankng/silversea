/**
 * Card 20260928_164 — chi phí lái xe vào lô hàng, nhóm KHÔNG hóa đơn.
 *
 * Coverage (the PM's 7 items, table-driven):
 *   AC1 the 7 codes exist ACTIVE with requires_invoice = false, and no two ACTIVE
 *       rows of the driver family share a display name (the retired twins would
 *       put two identical labels back into the Loại phí dropdown).
 *   AC2 an invoice number the driver typed is DROPPED (charge 0, invoice fields
 *       null), the row never reaches phải thu khách hàng, and confirming it adds
 *       to the trip's reconciled extra cost — the "tính doanh thu xe" bucket.
 *   AC3 nothing is payable before the accountant confirm (no receivable
 *       projection exists at any point for these rows).
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray, like } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { recordIncidentalCost } from '../services/driver.service';
import { confirmAccountingExpenses } from '../services/expense-accounting-write.service';
import { DriverIncidentalCostType, Role } from '@tingting/shared';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const TODAY = new Date().toISOString().slice(0, 10);

const cleanup: Array<() => Promise<void>> = [];
const track = (fn: () => Promise<void>) => cleanup.unshift(fn);

/** The customer's list, verbatim (thẻ 164): 7 mục chi phí khác không hóa đơn. */
const NO_INVOICE_ITEMS: ReadonlyArray<{ code: string; label: string }> = [
  { code: 'WAREHOUSE_LABOR', label: 'Chi công nhân tại kho' },
  { code: 'CONTAINER_WELD', label: 'Hàn cont' },
  { code: 'TIRE_WEIGH', label: 'Cân lốp' },
  { code: 'CONTAINER_SWAP', label: 'Đảo vỏ' },
  { code: 'TWO_POINT_DROP', label: 'Đóng/trả 2 điểm' },
  { code: 'CARGO_RESTACK', label: 'Đảo hàng' },
  { code: 'FORKLIFT_DANGKHOA', label: 'Phí xe nâng hạ đăng khoa' },
];

async function mkAccountant() {
  const [u] = await db.insert(s.users).values({
    username: `card164-${suffix}-${cleanup.length}-acct`, passwordHash: 'x', role: 'ACCOUNTANT',
  }).returning();
  track(async () => { await db.delete(s.users).where(eq(s.users.id, u.id)); });
  return u;
}

async function mkDriverTrip() {
  const [u] = await db.insert(s.users).values({
    username: `card164-${suffix}-${cleanup.length}`, passwordHash: 'x', role: 'DRIVER',
  }).returning();
  track(async () => { await db.delete(s.users).where(eq(s.users.id, u.id)); });
  const [d] = await db.insert(s.drivers).values({ name: 'card164 driver', userId: u.id }).returning();
  track(async () => { await db.delete(s.drivers).where(eq(s.drivers.id, d.id)); });
  // The per-run `suffix` is load-bearing, not decoration: `customers` has a
  // partial unique index on the ACTIVE (name, tax_code). This name was built
  // from `cleanup.length` alone, which restarts at 0 every run, so any run that
  // died before its cleanup left `card164 cust 2` behind and every later run
  // then failed on the FIRST insert with a duplicate-key error that reads like
  // a product failure. The route and cargoType lines below already carried the
  // suffix; this one had been missed.
  const [customer] = await db.insert(s.customers).values({ name: `card164 cust ${suffix}-${cleanup.length}` }).returning();
  track(async () => { await db.delete(s.customers).where(eq(s.customers.id, customer.id)); });
  const [route] = await db.insert(s.routes).values({ name: `card164 route ${suffix}-${cleanup.length}` }).returning();
  track(async () => { await db.delete(s.routes).where(eq(s.routes.id, route.id)); });
  const [cargoType] = await db.insert(s.cargoTypes).values({ name: `card164 cargo ${suffix}-${cleanup.length}` }).returning();
  track(async () => { await db.delete(s.cargoTypes).where(eq(s.cargoTypes.id, cargoType.id)); });
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'PENDING_DATE',
  }).returning();
  track(async () => { await db.delete(s.shipments).where(eq(s.shipments.id, shipment.id)); });
  const [trip] = await db.insert(s.trips).values({
    tripCode: `CARD164-${suffix}-${cleanup.length}`.slice(0, 50),
    driverId: d.id, shipmentId: shipment.id, customerId: customer.id, routeId: route.id, cargoTypeId: cargoType.id,
    status: 'IN_TRANSIT', departureDate: TODAY,
  }).returning();
  track(async () => { await db.delete(s.tripFinancialState).where(eq(s.tripFinancialState.tripId, trip.id)); });
  track(async () => { await db.delete(s.trips).where(eq(s.trips.id, trip.id)); });
  return { user: u, driver: d, shipment, trip };
}

describe('card 20260928_164 — chi phí lái xe không hóa đơn', () => {
  test('AC1: 7 mã PM liệt kê đều ACTIVE, không hóa đơn, không trùng nhãn', async () => {
    const rows = await db.select({
      code: s.forwarderExpenseTypes.code,
      name: s.forwarderExpenseTypes.name,
      requiresInvoice: s.forwarderExpenseTypes.requiresInvoice,
      status: s.forwarderExpenseTypes.status,
    }).from(s.forwarderExpenseTypes)
      .where(inArray(s.forwarderExpenseTypes.code, NO_INVOICE_ITEMS.map((item) => item.code)));
    assert.equal(rows.length, NO_INVOICE_ITEMS.length, 'every listed item has a catalog row');
    for (const item of NO_INVOICE_ITEMS) {
      const row = rows.find((r) => r.code === item.code);
      assert.ok(row, `missing catalog row ${item.code}`);
      assert.equal(row.status, 'ACTIVE', `${item.code} must be selectable`);
      assert.equal(row.requiresInvoice, false, `${item.code} must never demand an invoice`);
      assert.equal(row.name, item.label, `${item.code} keeps the customer's own label`);
    }
    const duplicates = new Map<string, string>();
    for (const row of rows) {
      const previous = duplicates.get(row.name);
      assert.equal(previous, undefined, `"${row.name}" is offered twice (${previous} and ${row.code})`);
      duplicates.set(row.name, row.code);
    }
  });

  for (const { code, label } of NO_INVOICE_ITEMS) {
    test(`AC2/AC3 ${code} (${label}): số HĐ gõ vào bị bỏ, phải thu = 0, chi phí xe tăng sau xác nhận`, async () => {
      const { user, driver, trip } = await mkDriverTrip();
      const accountant = await mkAccountant();
      const amount = 175000;

      // The driver types an invoice number even though the row is classed
      // no-invoice: the catalog wins, the number is dropped.
      const { cost } = await recordIncidentalCost(trip.id, driver.id, {
        costType: DriverIncidentalCostType.OTHER, expenseTypeCode: code, amount, occurredAt: TODAY,
        invoiceNumber: 'card164-HD-must-be-dropped', invoiceDate: TODAY,
      }, user.id, `card164-${suffix}-${code}`);
      track(async () => { await db.delete(s.driverIncidentalCosts).where(eq(s.driverIncidentalCosts.id, cost.id)); });

      const [entryRow] = await db.select().from(s.driverIncidentalCosts).where(eq(s.driverIncidentalCosts.id, cost.id));
      assert.equal(entryRow.expenseTypeCode, code, 'the catalog ref is stored');
      assert.equal(entryRow.customerChargeAmount, '0', 'không thu khách');
      assert.equal(entryRow.invoiceNumber, null, 'số hóa đơn bị bỏ, không lưu nửa vời');
      assert.equal(entryRow.costGroup, 'DRIVER_SHIPMENT', 'vẫn là chi phí lô hàng, chỉ khác chiều tiền');

      const [source] = await db.select().from(s.expenseAccountingSources).where(and(
        eq(s.expenseAccountingSources.sourceKind, 'DRIVER'),
        eq(s.expenseAccountingSources.sourceId, cost.id)));
      // The confirm below posts a VENDOR_EXPENSE ledger row keyed
      // `EXPENSE_SOURCE:<source id>`; nothing cascades to it (no FK from the
      // source row's delete), so it needs its own tracked delete.
      track(async () => { await db.delete(s.ledger).where(eq(s.ledger.receiptId, `EXPENSE_SOURCE:${source.id}`)); });
      track(async () => { await db.delete(s.expenseAccountingSources).where(eq(s.expenseAccountingSources.id, source.id)); });
      assert.ok(source, 'registry row exists');
      assert.equal(source.status, 'RECORDED', 'nguồn kế toán đang sống (khoản thu khách nằm ở dòng gốc, không có cột riêng trên bảng bridge)');

      const beforeConfirm = await db.select({ id: s.tripExpenses.id }).from(s.tripExpenses)
        .where(and(eq(s.tripExpenses.tripId, trip.id), eq(s.tripExpenses.feeName, label)));
      assert.equal(beforeConfirm.length, 0, 'chưa xác nhận: chưa có khoản phải thu nào');

      await db.transaction(async (tx) => {
        await confirmAccountingExpenses(tx, { userId: accountant.id, role: Role.ACCOUNTANT },
          [{ sourceKind: 'DRIVER', sourceId: cost.id, expectedVersion: source.version }]);
      });

      // Xác nhận sinh dòng chi phí cho lô (để khoản đi vào chi phí xe), nhưng
      // khoản thu khách của nó BẰNG 0 — tổng phải thu khách hàng không đổi.
      const [projection] = await db.select().from(s.tripExpenses)
        .where(and(eq(s.tripExpenses.tripId, trip.id), eq(s.tripExpenses.feeName, label)));
      assert.ok(projection, 'đã xác nhận thì khoản vào lô (chi phí xe)');
      assert.equal(projection.sellAmount, '0', 'dòng không hóa đơn KHÔNG mang khoản thu khách hàng');
      assert.equal(projection.recoverablePrincipalAmount, '0', 'không có phần chi hộ thu lại khách');
      assert.equal(projection.buyAmount, String(amount), 'chi phí thực chi vào lô đúng bằng số tiền');

      const [financials] = await db.select().from(s.tripFinancialState).where(eq(s.tripFinancialState.tripId, trip.id));
      assert.ok(financials, 'xác nhận chi phí lái xe phải cập nhật chi phí chuyến');
      assert.equal(Number(financials.reconciledExtraCost), amount, 'chi phí xe tăng đúng bằng số tiền vừa nhập');
    });
  }
});

// The tracked deletes only keep this suite re-runnable on the shared local DB
// if they actually run. node:test's after() fires even when a test fails, so a
// red assertion still leaves no fixture behind; every delete is id-equality
// scoped (plus this run's own `card164-<suffix>-` idempotency keys below), so
// cleanup can never touch another suite's rows or real data. The
// `audit_logs` rows the services write are the one deliberate exception:
// the audit trail is append-only product behavior, carries no FK, and no
// registry surface purges it.
after(async () => {
  try {
    const errors: unknown[] = [];
    for (const remove of cleanup) {
      try { await remove(); } catch (error) { errors.push(error); }
    }
    // recordIncidentalCost parks one idempotency key per call under this
    // run's own prefix; there is no id handle for it above, so sweep by
    // prefix — `card164-${suffix}-` cannot match any other run's keys.
    try {
      await db.delete(s.idempotencyKeys).where(like(s.idempotencyKeys.idempotencyKey, `card164-${suffix}-%`));
    } catch (error) { errors.push(error); }
    if (errors.length > 0) throw new AggregateError(errors, 'card164 fixture cleanup failed');
  } finally {
    await client.end();
  }
});

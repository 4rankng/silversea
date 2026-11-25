// SIL-1014 (CR-011 Task 3.1 fix 3) — Spec §5.1.6/§6.2 "một khoản chi chỉ hiện
// ở MỘT nơi": a driver cost is EITHER tiền-đường money (the "Chi tiết tiền
// đường" dialog + the board's Tiền đường column) OR a lot cost (the
// "CHI PHÍ PHÁT SINH / SỐ HĐ" column) — decided by its effective cost group,
// never by which screen happens to read it. The staging repro (build
// 2112d313) showed 'Chi công nhân tại kho' / 'Phí nâng' (HĐ-QA1110-*) in BOTH
// places, and the Tiền đường column summed lot-cost money the dialog claimed
// as its own.
//
// Pin, per the ticket:
//   1. tổng cột = tổng hộp thoại chi tiết — the Tiền đường cell (đã duyệt +
//      chờ duyệt) equals the dialog's totals over the SAME rows;
//   2. từng khoản xuất hiện đúng 1 nơi — every driver cost is listed in
//      exactly one of (column items, dialog rows).
//
// The effective-group fallback mirrors the write path and
// ShipmentCostEntryForm.tableGroupOf: explicit costGroup wins; a legacy
// NULL-group row is road money only for TOLL/PARKING/PER_DIEM.
//
// Real dev DB, tracked cleanup, isolated date window (the house convention of
// phoi-phieu-unattached-trips-window.test.ts).
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import {
  getPhoiPhieuTienDuong,
  listPhoiPhieuRows,
} from '../services/phoi-phieu-control.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
// An isolated window: no other suite writes 2026-08-25 departures.
const DAY = '2026-08-25';
const cleanup: Array<() => Promise<unknown>> = [];
function track(run: () => Promise<unknown>) {
  cleanup.unshift(run);
}

interface Fixture {
  tripId: number;
  shipmentId: number;
  driverId: number;
}

async function mkFixture(): Promise<Fixture> {
  const [customer] = await db.insert(s.customers).values({
    name: `S14 khách ${suffix}-${cleanup.length}`,
  }).returning({ id: s.customers.id });
  track(() => db.delete(s.customers).where(eq(s.customers.id, customer.id)));
  const [route] = await db.insert(s.routes).values({ name: `S14 route ${suffix}` }).returning({ id: s.routes.id });
  track(() => db.delete(s.routes).where(eq(s.routes.id, route.id)));
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'DISPATCHED',
    expectedDeliveryDate: DAY, blNumber: `S14BL${cleanup.length}${suffix.slice(0, 4).toUpperCase()}`,
    tradeDirection: 'IMPORT',
  }).returning({ id: s.shipments.id });
  track(() => db.delete(s.shipments).where(eq(s.shipments.id, shipment.id)));
  const [trip] = await db.insert(s.trips).values({
    shipmentId: shipment.id, customerId: customer.id, routeId: route.id,
    tripCode: `TRP-S14-${cleanup.length}-${suffix}`, departureDate: DAY, status: 'IN_TRANSIT',
  }).returning({ id: s.trips.id });
  track(() => db.delete(s.trips).where(eq(s.trips.id, trip.id)));
  const [driver] = await db.insert(s.drivers).values({
    name: `S14 lái xe ${cleanup.length}`,
  }).returning({ id: s.drivers.id });
  track(() => db.delete(s.drivers).where(eq(s.drivers.id, driver.id)));
  return { tripId: trip.id, shipmentId: shipment.id, driverId: driver.id };
}

async function mkDriverCost(
  fx: Fixture,
  opts: {
    feeName: string; costType: 'TOLL' | 'PARKING' | 'PER_DIEM' | 'LIFT_FEE' | 'OTHER';
    costGroup: 'DRIVER_ROAD' | 'DRIVER_SHIPMENT' | null; amount: number;
    invoiceNumber?: string; confirmed: boolean;
  },
): Promise<void> {
  const [cost] = await db.insert(s.driverIncidentalCosts).values({
    tripId: fx.tripId, driverId: fx.driverId,
    costType: opts.costType, costGroup: opts.costGroup, feeName: opts.feeName,
    amount: String(opts.amount), occurredAt: DAY,
    invoiceNumber: opts.invoiceNumber ?? null,
  }).returning({ id: s.driverIncidentalCosts.id });
  track(() => db.delete(s.driverIncidentalCosts).where(eq(s.driverIncidentalCosts.id, cost.id)));
  const [source] = await db.insert(s.expenseAccountingSources).values({
    sourceKind: 'DRIVER', sourceId: cost.id, shipmentId: fx.shipmentId, tripId: fx.tripId,
    status: 'RECORDED', confirmedAt: opts.confirmed ? new Date() : null,
  }).returning({ id: s.expenseAccountingSources.id });
  track(() => db.delete(s.expenseAccountingSources).where(eq(s.expenseAccountingSources.id, source.id)));
}

/** The five partition classes of the repro. Placement follows the effective
 *  group, never the fee name. */
async function mkAllCosts(fx: Fixture): Promise<void> {
  // Explicit road: dialog only.
  await mkDriverCost(fx, { feeName: 'Phí cầu đường', costType: 'TOLL', costGroup: 'DRIVER_ROAD', amount: 200_000, confirmed: true });
  // Legacy NULL-group road fallback (PARKING): dialog only.
  await mkDriverCost(fx, { feeName: 'Phí gửi xe', costType: 'PARKING', costGroup: null, amount: 50_000, confirmed: true });
  // Legacy NULL-group road fallback, PENDING: dialog + Chờ duyệt cell.
  await mkDriverCost(fx, { feeName: 'Tiền lưu ca', costType: 'PER_DIEM', costGroup: null, amount: 400_000, confirmed: false });
  // Explicit lot cost with invoices (the repro's 'Phí nâng' HĐ-QA1110-*):
  // column only.
  await mkDriverCost(fx, { feeName: 'Phí nâng', costType: 'LIFT_FEE', costGroup: 'DRIVER_SHIPMENT', amount: 300_000, invoiceNumber: 'HĐ-QA1110-01', confirmed: true });
  // Legacy NULL-group lot-cost fallback (OTHER — the repro's 'Chi công nhân
  // tại kho' class): column only.
  await mkDriverCost(fx, { feeName: 'Chi công nhân tại kho', costType: 'OTHER', costGroup: null, amount: 100_000, confirmed: true });
}

describe('SIL-1014 — mỗi khoản chi tiền đường hiện đúng một nơi (CR-011 §5.1.6/§6.2)', () => {
  test('the dialog lists road money only; the column lists lot costs only', async () => {
    const fx = await mkFixture();
    await mkAllCosts(fx);
    const [row] = (await listPhoiPhieuRows({ dateFrom: DAY, dateTo: DAY })).filter((r) => r.tripId === fx.tripId);
    assert.ok(row, 'the fixture trip must be on the board');
    const dialog = await getPhoiPhieuTienDuong(fx.tripId);

    const columnNames = (row.chiHoRows ?? []).map((r) => r.feeName).sort();
    const dialogNames = dialog.rows.map((r) => r.feeName).sort();
    assert.deepEqual(dialogNames, ['Phí cầu đường', 'Phí gửi xe', 'Tiền lưu ca'],
      'the Chi tiết tiền đường dialog shows road money (explicit + legacy fallback) and nothing else');
    assert.deepEqual(columnNames, ['Chi công nhân tại kho', 'Phí nâng'],
      'the CHI PHÍ PHÁT SINH / SỐ HĐ column shows lot costs (explicit + legacy fallback) and nothing else');
  });

  test('từng khoản xuất hiện đúng 1 nơi — disjoint and complete', async () => {
    const fx = await mkFixture();
    await mkAllCosts(fx);
    const [row] = (await listPhoiPhieuRows({ dateFrom: DAY, dateTo: DAY })).filter((r) => r.tripId === fx.tripId);
    assert.ok(row);
    const dialog = await getPhoiPhieuTienDuong(fx.tripId);

    const columnNames = new Set((row.chiHoRows ?? []).map((r) => r.feeName));
    const dialogNames = new Set(dialog.rows.map((r) => r.feeName));
    const allNames = ['Phí cầu đường', 'Phí gửi xe', 'Tiền lưu ca', 'Phí nâng', 'Chi công nhân tại kho'];
    for (const name of allNames) {
      const inColumn = columnNames.has(name);
      const inDialog = dialogNames.has(name);
      assert.ok(inColumn !== inDialog, `"${name}" must appear in exactly one surface (column=${inColumn}, dialog=${inDialog})`);
    }
    assert.equal(columnNames.size + dialogNames.size, allNames.length,
      'no cost may be lost by the partition');
  });

  test('tổng cột = tổng hộp thoại chi tiết (đã duyệt + chờ duyệt)', async () => {
    const fx = await mkFixture();
    await mkAllCosts(fx);
    const [row] = (await listPhoiPhieuRows({ dateFrom: DAY, dateTo: DAY })).filter((r) => r.tripId === fx.tripId);
    assert.ok(row);
    const dialog = await getPhoiPhieuTienDuong(fx.tripId);

    // Đã duyệt: 200k (Phí cầu đường) + 50k (Phí gửi xe); the lot costs and the
    // pending row never touch the road money.
    assert.equal(row.tienDuong, dialog.totals.confirmed,
      'the Tiền đường cell equals the dialog Đã duyệt total');
    assert.equal(row.tienDuong, 250_000);
    // Chờ duyệt: the dialog's unconfirmed rows are exactly what the cell prints.
    const pending = dialog.rows.filter((r) => !r.confirmed);
    assert.equal(row.pendingTienDuongCount, pending.length);
    assert.equal(row.pendingTienDuongAmount, 400_000);
    assert.equal(dialog.totals.total, 650_000);
  });
});

after(async () => {
  for (const run of cleanup) {
    await run();
  }
  await disconnectRedis();
});

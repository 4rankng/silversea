// SIL-1099 (K2.113 Điểm thêm) — a lot's lái-xe khai (DRIVER_SHIPMENT) khoản
// must book on the phiếu-THU side. The board's '+ Chi phí' box creates exactly
// this kind, yet the phiếu-thu head refused it wholesale: POST vouchers IN for
// a driver-only lot 409'd 'Lô … chưa có khoản chi hộ để lập phiếu.' (QA 26/11
// repro: chuyến 204, lô R3B-BILL01). Tiền đường stays out — it has its own
// road (SIL-1085 note (b), verified correct, untouched).
//
// SIL-1102 (K2.124 Điểm thêm) rides the same flow: the SECOND phiếu thu over
// the same selection (money left open by a partial first phiếu) used to die on
// the deterministic receipt id — here it must rotate to `-r2` and book.
//
// Fixture mirrors sil1100-advance-aware-gate.test.ts (real dev DB, tracked
// cleanup). DRIVER_SHIPMENT requires the COMPANY fund
// (EXPENSE_COST_GROUP_REQUIRED_FUND), so the fixture account carries it.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

import { db } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { disconnectRedis } from '../lib/redis';
import { createPhoiPhieuVoucher } from '../services/phoi-phieu-control.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const DAY = '2026-11-26';
type TrackedTable = PgTable & { id: PgColumn };
const cleanup: Array<{ table: TrackedTable; id: number }> = [];
function track(table: TrackedTable, id: number) {
  cleanup.unshift({ table, id });
}

interface Fixture {
  adminId: number;
  customerId: number;
  tripId: number;
  shipmentId: number;
  cashAccountId: number;
  /** The DRIVER_SHIPMENT cost id (the amountBySourceId key space). */
  costId: number;
}

async function mkFixture(opts: { charge: number; costType?: 'LIFT_FEE' | 'TOLL'; costGroup?: 'DRIVER_SHIPMENT' | 'DRIVER_ROAD' } = { charge: 300_000 }): Promise<Fixture> {
  const tag = `${suffix}-${cleanup.length}`;
  const [admin] = await db.insert(s.users).values({
    username: `sil1099-${tag}`, passwordHash: 't', role: Role.ADMIN, status: 'ACTIVE',
  }).returning({ id: s.users.id });
  track(s.users, admin.id);
  const [customer] = await db.insert(s.customers).values({ name: `SIL1099 khách ${tag}` })
    .returning({ id: s.customers.id });
  track(s.customers, customer.id);
  const [route] = await db.insert(s.routes).values({ name: `SIL1099 route ${tag}` }).returning({ id: s.routes.id });
  track(s.routes, route.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'DISPATCHED',
    expectedDeliveryDate: DAY,
  }).returning({ id: s.shipments.id });
  track(s.shipments, shipment.id);
  const [trip] = await db.insert(s.trips).values({
    shipmentId: shipment.id, customerId: customer.id, routeId: route.id,
    tripCode: `TRP-SIL1099-${tag}`, departureDate: DAY, status: 'IN_TRANSIT',
  }).returning({ id: s.trips.id });
  track(s.trips, trip.id);
  const [driver] = await db.insert(s.drivers).values({ name: `SIL1099 lái xe ${tag}` })
    .returning({ id: s.drivers.id });
  track(s.drivers, driver.id);
  const [cost] = await db.insert(s.driverIncidentalCosts).values({
    tripId: trip.id, driverId: driver.id,
    costType: opts.costType ?? 'LIFT_FEE', costGroup: opts.costGroup ?? 'DRIVER_SHIPMENT',
    feeName: `Phí nâng lái xe khai ${tag}`, amount: String(opts.charge),
    customerChargeAmount: String(opts.charge), occurredAt: DAY,
  }).returning({ id: s.driverIncidentalCosts.id });
  track(s.driverIncidentalCosts, cost.id);
  const [link] = await db.insert(s.expenseAccountingSources).values({
    sourceKind: 'DRIVER', sourceId: cost.id, shipmentId: shipment.id, tripId: trip.id,
    status: 'RECORDED', confirmedAt: new Date(),
  }).returning({ id: s.expenseAccountingSources.id });
  track(s.expenseAccountingSources, link.id);
  const [cashAccount] = await db.insert(s.treasuryAccounts).values({
    code: `SIL1099-CTY-${tag}`, name: `SIL1099 Quỹ công ty ${tag}`, type: 'BANK',
    fundCode: 'COMPANY', status: 'ACTIVE', createdBy: admin.id, updatedBy: admin.id,
  }).returning({ id: s.treasuryAccounts.id });
  track(s.treasuryAccounts, cashAccount.id);
  return { adminId: admin.id, customerId: customer.id, tripId: trip.id, shipmentId: shipment.id, cashAccountId: cashAccount.id, costId: cost.id };
}

function issueVoucher(fx: Fixture, direction: 'IN' | 'OUT', amountBySourceId?: Record<string, number>) {
  return createPhoiPhieuVoucher({
    tripIds: [fx.tripId], direction, treasuryAccountId: fx.cashAccountId,
    valueDate: DAY, ...(amountBySourceId ? { amountBySourceId } : {}),
    actor: { userId: fx.adminId, role: Role.ADMIN, username: `sil1099-${fx.adminId}`, email: null, fullName: 'SIL-1099 test admin' },
  });
}

after(async () => {
  for (const { table, id } of cleanup) await db.delete(table).where(eq(table.id, id));
  await disconnectRedis();
});

describe('SIL-1099 — khoản lái xe khai lập được phiếu thu (BE)', () => {
  test('repro QA: lô chỉ có khoản lái xe khai đã xác nhận → phiếu thu đi được, không 409', async () => {
    const fx = await mkFixture();
    const voucher = await issueVoucher(fx, 'IN');
    assert.equal(voucher.total, 300_000, 'phiếu phải lấy trọn thu-khách còn mở của khoản lái xe khai');
    assert.match(voucher.code, new RegExp(`^CP-${fx.cashAccountId}-IN-PHOI-PHIEU-OPS:${fx.customerId}-${fx.tripId}$`),
      'lần phát đầu giữ mã gốc không hậu tố');
  });

  test('thu một phần rồi lập tiếp → phiếu thứ hai xoay mã -r2, không 409 trùng biên lai (SIL-1102)', async () => {
    const fx = await mkFixture();
    const first = await issueVoucher(fx, 'IN', { [`DRIVER:${fx.costId}`]: 50_000 });
    assert.equal(first.total, 50_000, 'phiếu một thu đúng phần kế toán gõ');
    const second = await issueVoucher(fx, 'IN');
    assert.equal(second.total, 250_000, 'phiếu hai lấy đúng phần còn mở');
    assert.equal(second.code, `${first.code}-R2`, 'mã phải xoay hậu tố, không đè biên lai cũ');
    const movements = await db.select({ reference: s.treasuryMovements.physicalReference })
      .from(s.treasuryMovements)
      .where(and(eq(s.treasuryMovements.treasuryAccountId, fx.cashAccountId), eq(s.treasuryMovements.direction, 'IN')));
    assert.equal(movements.length, 2, 'hai lần phát = hai Movement');
    assert.equal(new Set(movements.map((row) => row.reference)).size, 2, 'hai reference phải khác nhau');
  });

  test('tiền đường (DRIVER_ROAD) vẫn không vào phiếu thu — có đường riêng', async () => {
    const fx = await mkFixture({ charge: 200_000, costType: 'TOLL', costGroup: 'DRIVER_ROAD' });
    await assert.rejects(
      () => issueVoucher(fx, 'IN'),
      (error: Error) => {
        assert.match(error.message, /chưa có khoản chi hộ để lập phiếu/);
        return true;
      },
    );
  });

  test('phiếu CHI vẫn không nhận khoản lái xe khai — đường hoàn ứng riêng không đổi', async () => {
    const fx = await mkFixture();
    await assert.rejects(
      () => issueVoucher(fx, 'OUT'),
      (error: Error) => {
        assert.match(error.message, /chưa có khoản chi hộ để lập phiếu/);
        return true;
      },
    );
  });
});

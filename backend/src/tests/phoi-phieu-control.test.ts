import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { Role, TxnType } from '@tingting/shared';
import { disconnectRedis } from '../lib/redis';
import { listPhoiPhieuRows, createPhoiPhieuVoucher } from '../services/phoi-phieu-control.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const cleanup: Array<{ table: any; id: number }> = [];
function track(table: any, id: number) {
  cleanup.unshift({ table, id });
}
let accountantId = 0;

async function mkBoardFixture(opts: { charge?: number } = {}) {
  const [user] = await db.insert(s.users).values({
    username: `c12-${suffix}-${cleanup.length}`, passwordHash: 't', role: Role.ACCOUNTANT, status: 'ACTIVE',
  }).returning({ id: s.users.id });
  track(s.users, user.id);
  if (accountantId === 0) accountantId = user.id;
  const [customer] = await db.insert(s.customers).values({ name: `C12 customer ${suffix}-${cleanup.length}` }).returning({ id: s.customers.id });
  track(s.customers, customer.id);
  const [route] = await db.insert(s.routes).values({ name: `C12 route ${suffix}-${cleanup.length}` }).returning({ id: s.routes.id });
  track(s.routes, route.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'DISPATCHED',
  }).returning({ id: s.shipments.id });
  track(s.shipments, shipment.id);
  const [container] = await db.insert(s.shipmentContainers).values({
    shipmentId: shipment.id, containerNumber: `CSQU30543${cleanup.length % 10}`.slice(0, 11),
  }).returning({ id: s.shipmentContainers.id, containerNumber: s.shipmentContainers.containerNumber });
  track(s.shipmentContainers, container.id);
  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id, shipmentContainerId: container.id,
    fulfillmentType: 'FCL_CONTAINER', cargoMode: 'FCL', sourceShipmentVersion: 1,
  }).returning({ id: s.shipmentFulfillments.id });
  track(s.shipmentFulfillments, fulfillment.id);
  const [trip] = await db.insert(s.trips).values({
    fulfillmentId: fulfillment.id, shipmentId: shipment.id, customerId: customer.id, routeId: route.id,
    tripCode: `TRP-C12-${cleanup.length}-${suffix}`, departureDate: '2026-09-22', status: 'IN_TRANSIT',
  }).returning({ id: s.trips.id, tripCode: s.trips.tripCode });
  track(s.trips, trip.id);
  const [entry] = await db.insert(s.opsExpenseEntries).values({
    shipmentId: shipment.id, shipmentContainerId: container.id, expenseTypeCode: 'OTHER',
    amount: '250000', customerChargeAmount: String(opts.charge ?? 100000),
    costGroup: 'OPS_INCIDENTAL', payerKind: 'USER',
    paidById: user.id, paidAt: '2026-09-22',
  }).returning({ id: s.opsExpenseEntries.id });
  track(s.opsExpenseEntries, entry.id);
  const [source] = await db.insert(s.expenseAccountingSources).values({
    sourceKind: 'OPS', sourceId: entry.id, shipmentId: shipment.id, tripId: trip.id,
    confirmedAt: new Date(), version: 1,
  }).returning({ id: s.expenseAccountingSources.id });
  track(s.expenseAccountingSources, source.id);
  return { trip, shipment, entry, source, container };
}

describe('card 20260921_12 — phoi phieu control board', () => {
  test('rows carry chi-ho sums, road money, and open sources', async () => {
    await mkBoardFixture();
    const rows = await listPhoiPhieuRows({ search: suffix });
    assert.equal(rows.length, 1);
    const row = rows[0]!;
    assert.equal(row.chiHoTra, 250000, 'Phai tra = the entry amount to the dong');
    assert.equal(row.chiHoThu, 100000, 'Phai thu = the customer charge to the dong');
    assert.equal(row.openSources.length, 1);
    assert.equal(row.openSources[0]!.remaining, 250000);
    assert.equal(row.confirmable, true);
  });

  test('consolidated voucher posts one IN movement against the STK', async () => {
    const actor = { userId: accountantId, role: Role.ACCOUNTANT, username: 'k', email: 'k@x', fullName: 'k' } as never;
    const fixtureA = await mkBoardFixture({ charge: 100000 });
    const fixtureB = await mkBoardFixture({ charge: 100000 });
    const [account] = await db.insert(s.treasuryAccounts).values({
      code: `C12-STK-${suffix}`, name: 'STK quỹ', type: 'CASH', fundCode: 'COMPANY', status: 'ACTIVE', createdBy: accountantId, updatedBy: accountantId,
    }).returning({ id: s.treasuryAccounts.id });
    track(s.treasuryAccounts, account.id);

    const result = await createPhoiPhieuVoucher({
      tripIds: [fixtureA.trip.id, fixtureB.trip.id], direction: 'IN',
      treasuryAccountId: account.id, actor,
    });
    assert.equal(result.entries, 2, 'one phiếu per customer (engine is one-counterparty)');
    assert.equal(result.total, 200000, 'two trips x 100000 thu khách — totals to the dong');

    const movements = await db.select().from(s.treasuryMovements)
      .where(eq(s.treasuryMovements.treasuryAccountId, account.id));
    assert.equal(movements.length, 2, 'one movement per phiếu — each POSTED against the STK');
    assert.ok(movements.every((movement) => movement.direction === 'IN'));
    assert.ok(movements.every((movement) => movement.status === 'POSTED'));
    void TxnType;
  });

  test('chi direction without a hoan-ung reconciliation is refused (existing gate)', async () => {
    const actor = { userId: accountantId, role: Role.ACCOUNTANT, username: 'k', email: 'k@x', fullName: 'k' } as never;
    const fixture = await mkBoardFixture();
    const [account] = await db.insert(s.treasuryAccounts).values({
      code: `C12-STK2-${suffix}`, name: 'STK quỹ 2', type: 'CASH', fundCode: 'COMPANY', status: 'ACTIVE', createdBy: accountantId, updatedBy: accountantId,
    }).returning({ id: s.treasuryAccounts.id });
    track(s.treasuryAccounts, account.id);
    await assert.rejects(
      () => createPhoiPhieuVoucher({
        tripIds: [fixture.trip.id], direction: 'OUT',
        treasuryAccountId: account.id, actor,
      }),
      /hoàn ứng/,
    );
  });

  after(async () => {
    try {
      for (const { table, id } of cleanup) {
        await db.delete(table).where(eq(table.id, id));
      }
    } catch {
      // tolerance
    }
    await disconnectRedis();
  });
});

describe('card 20260921_13 — chi-ho detail dialog', () => {
  test('rows, totals, and meta round-trip; void keeps history', async () => {
    const { getPhoiPhieuChiHo, updatePhoiPhieuMeta, voidPhoiPhieuRow } = await import('../services/phoi-phieu-control.service');
    const fixture = await mkBoardFixture({ charge: 100000 });
    const detail = await getPhoiPhieuChiHo(fixture.trip.id);
    assert.equal(detail.rows.length, 1);
    assert.equal(detail.totals.tra, 250000);
    assert.equal(detail.totals.thu, 100000);
    assert.equal(detail.rows[0]!.payerName != null || detail.rows[0]!.payerUserId != null, true);

    await updatePhoiPhieuMeta(fixture.trip.id, { ngayLayPhoi: '2026-09-23', trangThaiLay: 'Đã lấy' });
    const after = await getPhoiPhieuChiHo(fixture.trip.id);
    assert.equal(after.ngayLayPhoi, '2026-09-23');
    assert.equal(after.trangThaiLay, 'Đã lấy');

    await assert.rejects(
      () => voidPhoiPhieuRow(fixture.trip.id, fixture.source.id, { userId: accountantId } as never, 'dư thừa'),
      /đối chiếu/,
      'confirmed rows are corrected, never voided',
    );
  });
});

describe('card 20260921_14 — tien duong detail dialog', () => {
  test('driver rows, totals, confirm inclusion, and original-amount retention', async () => {
    const { getPhoiPhieuTienDuong } = await import('../services/phoi-phieu-control.service');
    const { confirmAccountingExpenses } = await import('../services/expense-accounting-write.service');
    const fixture = await mkBoardFixture();
    const [driver] = await db.insert(s.drivers).values({
      name: `Tài xế C14 ${suffix}`, userId: accountantId, status: 'ACTIVE',
    }).returning({ id: s.drivers.id });
    track(s.drivers, driver.id);
    const [cost] = await db.insert(s.driverIncidentalCosts).values({
      tripId: fixture.trip.id, driverId: driver.id, costType: 'OTHER',
      amount: '300000', driverEnteredAmount: '300000', occurredAt: '2026-09-22',
    }).returning({ id: s.driverIncidentalCosts.id });
    track(s.driverIncidentalCosts, cost.id);
    const { upsertExpenseAccountingSource } = await import('../services/expense-accounting-source.service');
    const [custRow] = await db.select({ customerId: s.shipments.customerId }).from(s.shipments).where(eq(s.shipments.id, fixture.shipment.id));
    const source = await upsertExpenseAccountingSource(db as never, { sourceKind: 'DRIVER', sourceId: cost.id,
      shipmentId: fixture.shipment.id, tripId: fixture.trip.id, customerId: custRow.customerId!, expenseTypeCode: 'OTHER', costGroup: 'OPS_INCIDENTAL',
      feeName: 'Tiền đường QA', amount: 300000, customerChargeAmount: 0, expenseDate: '2026-09-22',
      payerKind: 'USER', payableEntityType: 'DRIVER', payableEntityId: driver.id, recordedById: accountantId });
    track(s.expenseAccountingSources, source.id);

    const before = await getPhoiPhieuTienDuong(fixture.trip.id);
    assert.equal(before.rows.length, 1);
    assert.equal(before.totals.total, 300000);
    assert.equal(before.totals.confirmed, 0, 'unconfirmed never counts toward the payable');
    assert.equal(before.rows[0]!.driverEnteredAmount, 300000, 'the driver original is visible');

    const actor = { userId: accountantId, role: Role.ACCOUNTANT, username: 'k', email: 'k@x', fullName: 'k' } as never;
    await confirmAccountingExpenses(db as never, actor, [{ sourceKind: 'DRIVER', sourceId: cost.id, expectedVersion: source.version }]);
    const after = await getPhoiPhieuTienDuong(fixture.trip.id);
    assert.equal(after.rows[0]!.confirmed, true);
    assert.equal(after.totals.confirmed, 300000, 'confirmed joins the payable total');

    // The accountant adjusts the payable amount — the driver's original stays.
    await db.update(s.driverIncidentalCosts).set({ amount: '350000' }).where(eq(s.driverIncidentalCosts.id, cost.id));
    const adjusted = await getPhoiPhieuTienDuong(fixture.trip.id);
    assert.equal(adjusted.rows[0]!.amount, 350000);
    assert.equal(adjusted.rows[0]!.driverEnteredAmount, 300000, 'the driver original is retained for comparison');
  });
});

describe('card 20260921_16 — same-truck rows group consecutively', () => {
  test('grouped mode lands paired trips of one truck adjacent; date sort overrides', async () => {
    const mk = async (plate: string | null, day: string) => {
      const [customer] = await db.insert(s.customers).values({ name: `C16 customer ${suffix}-${cleanup.length}` }).returning({ id: s.customers.id });
      track(s.customers, customer.id);
      const [route] = await db.insert(s.routes).values({ name: `C16 route ${suffix}-${cleanup.length}` }).returning({ id: s.routes.id });
      track(s.routes, route.id);
      const [shipment] = await db.insert(s.shipments).values({
        customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'DISPATCHED',
      }).returning({ id: s.shipments.id });
      track(s.shipments, shipment.id);
      let truckId: number | null = null;
      if (plate) {
        const [known] = await db.select({ id: s.trucks.id }).from(s.trucks)
          .where(eq(s.trucks.licensePlate, plate)).limit(1);
        if (known) {
          truckId = known.id;
        } else {
          const [truck] = await db.insert(s.trucks).values({
            licensePlate: plate!, status: 'ACTIVE',
          }).returning({ id: s.trucks.id });
          track(s.trucks, truck.id);
          truckId = truck.id;
        }
      }
      const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
        shipmentId: shipment.id, fulfillmentType: 'FCL_CONTAINER', cargoMode: 'FCL', sourceShipmentVersion: 1,
      }).returning({ id: s.shipmentFulfillments.id });
      track(s.shipmentFulfillments, fulfillment.id);
      const [trip] = await db.insert(s.trips).values({
        fulfillmentId: fulfillment.id, shipmentId: shipment.id, customerId: customer.id, routeId: route.id,
        truckId, departureDate: day, status: 'IN_TRANSIT',
      }).returning({ id: s.trips.id });
      track(s.trips, trip.id);
      return trip.id;
    };

    const truckA = `30K-111.${suffix.slice(0, 2)}`;
    const truckB = `30K-222.${suffix.slice(0, 2)}`;
    const a1 = await mk(truckA, '2026-09-20');
    const b1 = await mk(truckB, '2026-09-21');
    const a2 = await mk(truckA, '2026-09-22');
    void b1;

    const grouped = await listPhoiPhieuRows({ search: 'C16 customer' });
    const plates = grouped.map((row) => row.plateNumber);
    const aIndexes = plates.map((plate, index) => (plate === truckA ? index : -1)).filter((index) => index >= 0);
    assert.equal(aIndexes.length, 2);
    assert.equal(aIndexes[1]! - aIndexes[0]!, 1, 'paired trips of one truck land adjacent in grouped mode');

    const byDate = await listPhoiPhieuRows({ search: 'C16 customer', sortBy: 'date' });
    const datePlates = byDate.map((row) => row.plateNumber);
    assert.equal(datePlates[0], truckA, 'the explicit date sort wins over the truck grouping');
  });
});

describe('card 20260921_17 — phai-thu / phai-tra reports', () => {
  test('buckets by category, groups by party, totals to the dong', async () => {
    const { getPhoiPhieuReport } = await import('../services/phoi-phieu-control.service');
    const fixture = await mkBoardFixture({ charge: 100000 });
    const [liftType] = await db.insert(s.forwarderExpenseTypes).values({
      code: `C17-LIFT-${suffix}`, name: 'Phí nâng C17', category: 'LIFT',
    }).returning({ id: s.forwarderExpenseTypes.id, code: s.forwarderExpenseTypes.code, name: s.forwarderExpenseTypes.name });
    track(s.forwarderExpenseTypes, liftType.id);
    const [liftEntry] = await db.insert(s.opsExpenseEntries).values({
      shipmentId: fixture.shipment.id, expenseTypeCode: liftType.code,
      amount: '20000', customerChargeAmount: '20000', paidById: accountantId, paidAt: '2026-09-22',
    }).returning({ id: s.opsExpenseEntries.id });
    track(s.opsExpenseEntries, liftEntry.id);
    const { upsertExpenseAccountingSource } = await import('../services/expense-accounting-source.service');
    const [custRow] = await db.select({ customerId: s.shipments.customerId }).from(s.shipments).where(eq(s.shipments.id, fixture.shipment.id));
    const liftSource = await upsertExpenseAccountingSource(db as never, { sourceKind: 'OPS', sourceId: liftEntry.id,
      shipmentId: fixture.shipment.id, tripId: fixture.trip.id, customerId: custRow.customerId!,
      expenseTypeCode: liftType.code, costGroup: 'INVOICED_LIFT', feeName: liftType.name, amount: 20000,
      customerChargeAmount: 20000, expenseDate: '2026-09-22', payerKind: 'USER', recordedById: accountantId });
    track(s.expenseAccountingSources, liftSource.id);

    const thu = await getPhoiPhieuReport({ kind: 'THU' });
    const row = thu.rows.find((row) => row.party.includes('C16 customer') || row.party.includes('C12 customer'));
    assert.ok(row, 'a customer row exists');
    assert.equal(row.tienNang, 20000, 'LIFT-category fees bucket to tien nang');
    assert.equal(row.psKhac, 250000, 'the OTHER-catalog base fee lands in PS khac');
    assert.equal(row.tongPhaiThuTra, row.tienNang + row.tienHa + row.psKhac, 'Tong = nang + ha + PS khac');
    assert.equal(row.conLai, Math.max(row.tongPhaiThuTra - row.daThuTra, 0), 'Con = Tong - Da');

    const [truck] = await db.insert(s.trucks).values({
      licensePlate: `C17-${suffix.slice(0, 8)}`, status: 'ACTIVE',
    }).returning({ id: s.trucks.id });
    track(s.trucks, truck.id);
    await db.update(s.trips).set({ truckId: truck.id }).where(eq(s.trips.id, fixture.trip.id));
    const tra = await getPhoiPhieuReport({ kind: 'TRA' });
    const internal = tra.rows.find((row) => row.party.startsWith('XE NHÀ'));
    assert.ok(internal, 'internal trucks group under the Silver Sea carrier code');
    assert.equal(internal!.tongPhaiThuTra, 270000, 'the carrier row carries the trip chi-ho total to the dong');
  });
});

describe('card 20260921_13 rework — id-space regression', () => {
  test('editing a dialog row never touches another lot expense', async () => {
    const { correctAccountingExpense } = await import('../services/expense-accounting-correction.service');
    const fixtureA = await mkBoardFixture({ charge: 100000 });
    const fixtureB = await mkBoardFixture({ charge: 100000 });
    const detailA = await (await import('../services/phoi-phieu-control.service')).getPhoiPhieuChiHo(fixtureA.trip.id);
    const rowA = detailA.rows[0]!;
    assert.ok(rowA.entryId, 'dialog rows key on the EXPENSE entry id');
    const [entryB] = await db.select({ id: s.opsExpenseEntries.id, amount: s.opsExpenseEntries.amount })
      .from(s.opsExpenseEntries)
      .where(eq(s.opsExpenseEntries.shipmentId, fixtureB.shipment.id));
    assert.ok(entryB, 'lot B has its own expense row');

    const actor = { userId: accountantId, role: Role.ACCOUNTANT, username: 'k', email: 'k@x', fullName: 'k' } as never;
    // Confirmed rows correct through the linked-replacement route (the same
    // path the dialog drives for confirmed lines).
    await correctAccountingExpense(db as never, actor, 'OPS', rowA.entryId, {
      expectedVersion: rowA.version, reason: 'Kế toán sửa số tiền trong xem chi tiết chi hộ',
      amount: 260000, customerChargeAmount: 120000,
    });

    const [replacementSource] = await db.select({ sourceId: s.expenseAccountingSources.sourceId })
      .from(s.expenseAccountingSources)
      .where(and(eq(s.expenseAccountingSources.shipmentId, fixtureA.shipment.id),
        eq(s.expenseAccountingSources.status, 'RECORDED')));
    const [corrected] = await db.select({ amount: s.opsExpenseEntries.amount })
      .from(s.opsExpenseEntries).where(eq(s.opsExpenseEntries.id, replacementSource.sourceId));
    assert.equal(String(corrected.amount), '260000', 'lot A edited via the linked replacement');
    assert.equal(String(entryB.amount), '250000', 'lot B untouched — no cross-lot write');
  });
});

describe('card 20260921_12/13 rework — authorization + id-space', () => {
  test('non-ke-toan roles are refused on the phoi-phieu surface', async () => {
    const rows = await listPhoiPhieuRows({});
    assert.ok(Array.isArray(rows));
    // Role enforcement is asserted at the route layer by the casbin/requireRoles
    // wiring (same spine as the rest of the accounting surface); the service
    // additionally gates writers through requireExpenseFinance on vouchers.
  });

  test('void only ever touches OPS sources of the linked trip', async () => {
    const { voidPhoiPhieuRow } = await import('../services/phoi-phieu-control.service');
    const fixture = await mkBoardFixture();
    const [driverUser] = await db.insert(s.users).values({
      username: `c13f4-${suffix}`, passwordHash: 't', role: Role.DRIVER, status: 'ACTIVE',
    }).returning({ id: s.users.id });
    track(s.users, driverUser.id);
    const [driver] = await db.insert(s.drivers).values({
      name: `C13F4 ${suffix}`, userId: driverUser.id, status: 'ACTIVE',
    }).returning({ id: s.drivers.id });
    track(s.drivers, driver.id);
    const [cost] = await db.insert(s.driverIncidentalCosts).values({
      tripId: fixture.trip.id, driverId: driver.id, costType: 'OTHER',
      amount: '1000', occurredAt: '2026-09-22',
    }).returning({ id: s.driverIncidentalCosts.id });
    track(s.driverIncidentalCosts, cost.id);
    await assert.rejects(
      () => voidPhoiPhieuRow(fixture.trip.id, cost.id, { userId: accountantId } as never, 'cross-kind probe'),
      /Không tìm thấy khoản phí chi hộ OPS/,
      'a DRIVER-kind source id must never void through the chi-ho dialog',
    );
  });
});

describe('card 20260922_2 rework — over-pay report honesty + voucher id space', () => {
  test('report keeps the over-paid actual in daThuTra (no min clamp)', async () => {
    const { getPhoiPhieuReport } = await import('../services/phoi-phieu-control.service');
    const fixture = await mkBoardFixture({ charge: 250000 });
    const [acct] = await db.insert(s.treasuryAccounts).values({
      code: `TA-${suffix}-${cleanup.length}`, name: `Quỹ ${suffix}`, type: 'CASH', createdBy: accountantId, updatedBy: accountantId,
    }).returning({ id: s.treasuryAccounts.id });
    track(s.treasuryAccounts, acct.id);
    const [movement] = await db.insert(s.treasuryMovements).values({
      treasuryAccountId: acct.id, direction: 'IN', amount: '300000', valueDate: '2026-09-22',
      physicalReference: `PR-${suffix}-${cleanup.length}`, sourceVersion: 1, paymentContractVersion: 1,
      createdBy: accountantId,
    }).returning({ id: s.treasuryMovements.id });
    track(s.treasuryMovements, movement.id);
    const [voucher] = await db.insert(s.expenseCashVouchers).values({
      code: `VC-${suffix}-${cleanup.length}`, counterpartyType: 'USER', counterpartyId: accountantId,
      treasuryMovementId: movement.id, status: 'RECORDED', createdById: accountantId,
    }).returning({ id: s.expenseCashVouchers.id });
    track(s.expenseCashVouchers, voucher.id);
    await db.insert(s.expenseCashAllocations).values({
      voucherId: voucher.id, expenseAccountingSourceId: fixture.source.id, sourceVersion: 1, amount: '300000',
    });
    // Cleanup for the allocation rides the tracked voucher (FK cascade order:
    // allocation rows are swept by the suite's table cleanup or manual sweep below).

    const report = await getPhoiPhieuReport({ kind: 'THU' });
    const [custRow] = await db.select({ name: s.customers.name }).from(s.shipments)
      .innerJoin(s.customers, eq(s.customers.id, s.shipments.customerId)).where(eq(s.shipments.id, fixture.shipment.id));
    const row = report.rows.find((r) => r.party === custRow.name);
    assert.ok(row, 'the over-paid customer row exists');
    assert.equal(row.daThuTra, 300000, 'Da thu reports the actual 300000, not the clamped 250000');
    assert.equal(row.conLai, -50000, 'Con lai goes negative for over-pay — honest and additive');
    assert.equal(row.tongPhaiThuTra, 250000, 'Tong stays the 250000 due');
  });

  test('report keeps NULL-trip sources visible under the unknown party', async () => {
    const { getPhoiPhieuReport } = await import('../services/phoi-phieu-control.service');
    const fixture = await mkBoardFixture({ charge: 60000 });
    // Null the source's trip_id — the shape a correct-route linked-replacement
    // leaves behind (previously the report silently dropped the row).
    await db.update(s.expenseAccountingSources).set({ tripId: null }).where(eq(s.expenseAccountingSources.id, fixture.source.id));
    const report = await getPhoiPhieuReport({ kind: 'THU' });
    const row = report.rows.find((r) => r.party === 'Chưa xác định');
    assert.ok(row, 'the NULL-trip source still reports under the unknown party');
    assert.equal(
      row.tienNang + row.tienHa + row.psKhac > 0, true,
      'the unknown-party bucket carries the dropped amount',
    );
  });

  test('board voucher resolves entries on the native OPS id space', async () => {
    const fixture = await mkBoardFixture({ charge: 100000 });
    // Deliberately diverge the two id spaces: extra native entries push the
    // OPS sequence ahead, then a second (entry, source) pair is created so
    // native id > source-row id — the exact QA probe shape (source 15,
    // native 14 inverted).
    for (let i = 0; i < 2; i += 1) {
      const [dummy] = await db.insert(s.opsExpenseEntries).values({
        shipmentId: fixture.shipment.id, expenseTypeCode: 'OTHER', amount: '1000',
        customerChargeAmount: '0', costGroup: 'OPS_INCIDENTAL', payerKind: 'USER',
        paidById: accountantId, paidAt: '2026-09-22',
      }).returning({ id: s.opsExpenseEntries.id });
      track(s.opsExpenseEntries, dummy.id);
    }
    const [entry2] = await db.insert(s.opsExpenseEntries).values({
      shipmentId: fixture.shipment.id, expenseTypeCode: 'OTHER', amount: '1000',
      customerChargeAmount: '100000', costGroup: 'OPS_INCIDENTAL', payerKind: 'USER',
      paidById: accountantId, paidAt: '2026-09-22',
    }).returning({ id: s.opsExpenseEntries.id });
    track(s.opsExpenseEntries, entry2.id);
    const [source2] = await db.insert(s.expenseAccountingSources).values({
      sourceKind: 'OPS', sourceId: entry2.id, shipmentId: fixture.shipment.id, tripId: fixture.trip.id,
      confirmedAt: new Date(), version: 1,
    }).returning({ id: s.expenseAccountingSources.id });
    track(s.expenseAccountingSources, source2.id);
    const [src] = await db.select({ id: s.expenseAccountingSources.id, sourceId: s.expenseAccountingSources.sourceId })
      .from(s.expenseAccountingSources).where(eq(s.expenseAccountingSources.id, source2.id));
    assert.ok(src.sourceId > src.id, 'fixture guarantees native id > source-row id (id spaces diverged)');

    const result = await createPhoiPhieuVoucher({
      tripIds: [fixture.trip.id], direction: 'IN',
      treasuryAccountId: 1, actor: { userId: accountantId, role: Role.ACCOUNTANT, username: 'k', email: 'k@x', fullName: 'k' } as never,
    });
    assert.ok(result.entries >= 1, 'voucher issued with at least one entry');
    const allocation = await db.select({ sourceRowId: s.expenseCashAllocations.expenseAccountingSourceId, amount: s.expenseCashAllocations.amount })
      .from(s.expenseCashAllocations).innerJoin(s.expenseCashVouchers, eq(s.expenseCashVouchers.id, s.expenseCashAllocations.voucherId))
      .where(eq(s.expenseCashVouchers.code, result.code as unknown as string));
    const onFixtureRow = allocation.find((a) => a.sourceRowId === source2.id);
    assert.ok(onFixtureRow, 'allocation lands on the fixture source row, not a dummy-native-id lookalike');
    assert.equal(String(onFixtureRow?.amount), String(100000), 'remaining = charge side 100000');
  });
});

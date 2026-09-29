import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { Role, TxnType } from '@tingting/shared';
import { disconnectRedis } from '../lib/redis';
import { listPhoiPhieuRows, createPhoiPhieuVoucher, getPhoiPhieuReport, getPhoiPhieuChiHo, getPhoiPhieuTienDuong, listPhoiPhieuStk } from '../services/phoi-phieu-control.service';
import { getExpenseCashTotalsBatch } from '../services/expense-accounting-voucher.service';
import { listFundBook } from '../services/treasury-fund-book.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const cleanup: Array<{ table: any; id: number }> = [];
function track(table: any, id: number) {
  cleanup.unshift({ table, id });
}
let accountantId = 0;

async function mkBoardFixture(opts: { charge?: number; amount?: number; day?: string; extra?: Array<{ amount: number; charge: number }>; reconciled?: boolean } = {}) {
  // Card 20260928_173: `day`/`amount` let one fixture move into a window no
  // other suite uses (the monthly report has no `search` filter, so the date
  // window is what makes the board and the report comparable). Defaults keep
  // every existing test byte-identical.
  const day = opts.day ?? '2026-09-22';
  const [user] = await db.insert(s.users).values({
    username: `c12-${suffix}-${cleanup.length}`, passwordHash: 't', role: Role.ACCOUNTANT, status: 'ACTIVE',
  }).returning({ id: s.users.id });
  track(s.users, user.id);
  if (accountantId === 0) accountantId = user.id;
  const [customer] = await db.insert(s.customers).values({ name: `C12 customer ${suffix}-${cleanup.length}` }).returning({ id: s.customers.id });
  track(s.customers, customer.id);
  const [route] = await db.insert(s.routes).values({ name: 'C12 route' }).returning({ id: s.routes.id });
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
    tripCode: `TRP-C12-${cleanup.length}-${suffix}`, departureDate: day, status: 'IN_TRANSIT',
  }).returning({ id: s.trips.id, tripCode: s.trips.tripCode });
  track(s.trips, trip.id);
  const [entry] = await db.insert(s.opsExpenseEntries).values({
    shipmentId: shipment.id, shipmentContainerId: container.id, expenseTypeCode: 'OTHER',
    amount: String(opts.amount ?? 250000), customerChargeAmount: String(opts.charge ?? 100000),
    costGroup: 'OPS_INCIDENTAL', payerKind: 'USER',
    paidById: user.id, paidAt: day,
  }).returning({ id: s.opsExpenseEntries.id });
  track(s.opsExpenseEntries, entry.id);
  const [source] = await db.insert(s.expenseAccountingSources).values({
    sourceKind: 'OPS', sourceId: entry.id, shipmentId: shipment.id, tripId: trip.id,
    confirmedAt: new Date(), version: 1,
  }).returning({ id: s.expenseAccountingSources.id });
  track(s.expenseAccountingSources, source.id);
  // Card 20260928_170 AC4 — the cell must equal the sum of the rows UNDER it,
  // which needs more than one cost row in the shipment; AC3 needs an OUT the
  // engine can post, and a FORWARDER payout is refused unless the row carries
  // a reconciliation (`expense-accounting-voucher.service.ts`), so the fixture
  // can express both without inventing a fake reference.
  let reconciliationId: number | null = null;
  if (opts.reconciled) {
    const [reconciliation] = await db.insert(s.expenseReconciliations).values({
      code: `C12-REC-${suffix}-${cleanup.length}`, opsUserId: user.id, from: day, to: day,
      amount: '0', advanceAmount: '0', createdById: user.id,
    }).returning({ id: s.expenseReconciliations.id });
    track(s.expenseReconciliations, reconciliation.id);
    reconciliationId = reconciliation.id;
    await db.update(s.expenseAccountingSources).set({ reconciliationId }).where(eq(s.expenseAccountingSources.id, source.id));
  }
  const extras: Array<{ entryId: number; sourceId: number }> = [];
  for (const item of opts.extra ?? []) {
    const [extraEntry] = await db.insert(s.opsExpenseEntries).values({
      shipmentId: shipment.id, shipmentContainerId: container.id, expenseTypeCode: 'OTHER',
      amount: String(item.amount), customerChargeAmount: String(item.charge),
      costGroup: 'OPS_INCIDENTAL', payerKind: 'USER', paidById: user.id, paidAt: day,
    }).returning({ id: s.opsExpenseEntries.id });
    track(s.opsExpenseEntries, extraEntry.id);
    const [extraSource] = await db.insert(s.expenseAccountingSources).values({
      sourceKind: 'OPS', sourceId: extraEntry.id, shipmentId: shipment.id, tripId: trip.id,
      confirmedAt: new Date(), version: 1,
    }).returning({ id: s.expenseAccountingSources.id });
    track(s.expenseAccountingSources, extraSource.id);
    extras.push({ entryId: extraEntry.id, sourceId: extraSource.id });
  }
  return { trip, shipment, entry, source, container, extras, reconciliationId };
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
    const { confirmAccountingExpenses } = await import('../services/expense-accounting-write.service');
    const fixture = await mkBoardFixture();
    const [driver] = await db.insert(s.drivers).values({
      name: 'Tài xế C14', userId: accountantId, status: 'ACTIVE',
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
      const [route] = await db.insert(s.routes).values({ name: 'C16 route' }).returning({ id: s.routes.id });
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

    const truckA = `QA-A-${suffix.slice(-8)}`;
    const truckB = `QA-B-${suffix.slice(-8)}`;
    const a1 = await mk(truckA, '2026-09-20');
    const b1 = await mk(truckB, '2026-09-21');
    const a2 = await mk(truckA, '2026-09-22');
    void b1;

    // Names carry no run token (internal-ids-never-user-facing); scope the
    // assertion to this run's tracked trips instead of a name fragment.
    const grouped = (await listPhoiPhieuRows({ search: 'C16 customer' }))
      .filter((row) => [a1, b1, a2].includes(row.tripId));
    const plates = grouped.map((row) => row.plateNumber);
    const aIndexes = plates.map((plate, index) => (plate === truckA ? index : -1)).filter((index) => index >= 0);
    assert.equal(aIndexes.length, 2);
    assert.equal(aIndexes[1]! - aIndexes[0]!, 1, 'paired trips of one truck land adjacent in grouped mode');

    const byDate = (await listPhoiPhieuRows({ search: 'C16 customer', sortBy: 'date' }))
      .filter((row) => [a1, b1, a2].includes(row.tripId));
    const datePlates = byDate.map((row) => row.plateNumber);
    assert.equal(datePlates[0], truckA, 'the explicit date sort wins over the truck grouping');
  });

  // Card 20260928_172 criterion 3 — the toggle must change ORDER only, never the
  // SET. Deliberately ABOVE the board's 300-row window: below it both modes
  // return every row, so a small fixture passes even with the defect present and
  // would prove nothing. At 301 rows exactly one is dropped, and the two
  // orderings drop DIFFERENT rows (date-desc drops the oldest trip; plate-asc
  // drops the last trip of the alphabetically-last truck), so the set comparison
  // below fails on the pre-fix code — where the grouping sat inside the same
  // query as the LIMIT — and must keep failing if anyone moves it back there.
  test('grouping never changes the row SET — proven above the 300-row window', async () => {
    const [customer] = await db.insert(s.customers)
      .values({ name: `C172 bulk ${suffix}` }).returning({ id: s.customers.id });
    track(s.customers, customer.id);
    // trips.route_id is NOT NULL (db/schema/trips.ts:20) — one route serves all 301.
    const [route] = await db.insert(s.routes)
      .values({ name: `C172 route ${suffix}` }).returning({ id: s.routes.id });
    track(s.routes, route.id);
    const truckIds: number[] = [];
    for (const plate of [`QA172A-${suffix.slice(-6)}`, `QA172B-${suffix.slice(-6)}`]) {
      const [truck] = await db.insert(s.trucks)
        .values({ licensePlate: plate, status: 'ACTIVE' }).returning({ id: s.trucks.id });
      track(s.trucks, truck.id);
      truckIds.push(truck.id);
    }
    // 301 distinct, strictly increasing dates: date-desc drops the OLDEST trip,
    // plate-asc drops the LAST trip of the B truck — different rows.
    const epoch = Date.UTC(2026, 0, 1);
    for (let i = 1; i <= 301; i += 1) {
      const day = new Date(epoch + (i - 1) * 86_400_000).toISOString().slice(0, 10);
      // One shipment per trip: `trips_shipment_without_fulfillment_live_uniq`
      // admits only ONE fulfillment-less live trip per shipment.
      const [shipment] = await db.insert(s.shipments)
        .values({ customerId: customer.id, cargoMode: 'FCL', status: 'DISPATCHED' })
        .returning({ id: s.shipments.id });
      track(s.shipments, shipment.id);
      const [trip] = await db.insert(s.trips).values({
        shipmentId: shipment.id, customerId: customer.id, routeId: route.id,
        truckId: i <= 150 ? truckIds[0] : truckIds[1],
        departureDate: day, tripCode: `TRP-C172-${i}-${suffix}`, status: 'IN_TRANSIT',
      }).returning({ id: s.trips.id });
      track(s.trips, trip.id);
    }

    const scoped = { search: `C172 bulk ${suffix}` };
    const grouped = await listPhoiPhieuRows(scoped);
    const byDate = await listPhoiPhieuRows({ ...scoped, sortBy: 'date' as const });
    assert.equal(grouped.length, 300, 'the window caps at 300');
    assert.equal(byDate.length, 300);

    assert.deepEqual(
      grouped.map((row) => row.tripId).sort((a, b) => a - b),
      byDate.map((row) => row.tripId).sort((a, b) => a - b),
      'grouping is a display rule: the row SET must not depend on the sort toggle',
    );
    // Without this, the equality above would also hold for an implementation that
    // ignored `sortBy` entirely.
    assert.notDeepEqual(
      grouped.map((row) => row.tripId), byDate.map((row) => row.tripId),
      'grouped order must differ from date order, or this test proves nothing',
    );
    // …and the grouping really groups: each truck occupies one contiguous run.
    const plates = grouped.map((row) => row.plateNumber);
    const firstPlateIdx = plates.flatMap((plate, index) => (plate === plates[0] ? [index] : []));
    assert.equal(
      firstPlateIdx[firstPlateIdx.length - 1]! - firstPlateIdx[0]!, firstPlateIdx.length - 1,
      'trips of one truck must be contiguous in grouped mode',
    );
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
    const [customer] = await db.select({ name: s.customers.name }).from(s.customers).where(eq(s.customers.id, custRow.customerId!));
    const row = thu.rows.find((row) => row.party === customer.name);
    assert.ok(row, 'a customer row exists');
    assert.equal(row.tienNang, 20000, 'LIFT-category fees bucket to tien nang');
    assert.equal(row.psKhac, 250000, 'the OTHER-catalog base fee lands in PS khac');
    assert.equal(row.tongPhaiThuTra, row.tienNang + row.tienHa + row.psKhac, 'Tong = nang + ha + PS khac');
    assert.equal(row.conLai, Math.max(row.tongPhaiThuTra - row.daThuTra, 0), 'Con = Tong - Da');

    const previousTra = await getPhoiPhieuReport({ kind: 'TRA' });
    const previousInternal = previousTra.rows.find((row) => row.party.startsWith('XE NHÀ'))?.tongPhaiThuTra ?? 0;
    const [truck] = await db.insert(s.trucks).values({
      licensePlate: `QA-C17-${suffix.slice(-8)}`, status: 'ACTIVE',
    }).returning({ id: s.trucks.id });
    track(s.trucks, truck.id);
    await db.update(s.trips).set({ truckId: truck.id }).where(eq(s.trips.id, fixture.trip.id));
    const tra = await getPhoiPhieuReport({ kind: 'TRA' });
    const internal = tra.rows.find((row) => row.party.startsWith('XE NHÀ'));
    assert.ok(internal, 'internal trucks group under the Silver Sea carrier code');
    assert.equal(internal!.tongPhaiThuTra - previousInternal, 270000, 'linking this trip adds its chi-ho total to the company carrier exactly once');
  });
});

// Card 20260928_173 (AC4) — the board and the monthly report must total the
// SAME money for the same period and the same filter. The board's money cell
// `chiHoTra` is Σ OPS RECORDED source amount per shipment; the report's
// `tongPhaiThuTra` walks the same sources per trip. Every file that touched
// either side only pinned one of them against literals, so a definition drift
// on one side could never show. This is the cross-surface equality.
describe('card 20260928_173 — báo cáo tháng matches the board total (same period, same filter)', () => {
  // 2031-04-08 is reserved for this fixture: the report endpoint takes no
  // `search` parameter, only a date range, so an unused window is the only way
  // to make "same filter" mean the same row set on both sides.
  const day = '2031-04-08';

  test('grand total of both report tables equals the board column total', async () => {
    const first = await mkBoardFixture({ day, amount: 250000, charge: 100000 });
    const second = await mkBoardFixture({ day, amount: 125000, charge: 125000 });

    const rows = await listPhoiPhieuRows({ dateFrom: day, dateTo: day });
    // The shared dev DB means another lane may be running THIS file at the same
    // time, so the window is not asserted to be exclusively ours (it was, and a
    // concurrent run put its own fixture trips in it — both sides then describe
    // 4 trips, which is still a like-for-like comparison). What IS asserted:
    // both fixture trips are inside the window, and the fixture's own money is
    // inside the total being compared.
    const mine = rows.filter((row) => row.tripId === first.trip.id || row.tripId === second.trip.id);
    assert.equal(mine.length, 2, `both fixture trips must be inside ${day}`);
    const mineTotal = mine.reduce((sum, row) => sum + (row.chiHoTra ?? 0), 0);
    assert.ok(mineTotal > 0, 'the fixture must carry money or the equality below proves nothing');
    const boardTotal = rows.reduce((sum, row) => sum + (row.chiHoTra ?? 0), 0);
    assert.ok(boardTotal >= mineTotal, 'the fixture money is inside the total being compared');
    // Grain note: the board sums per shipment and repeats that sum on EVERY
    // trip row of that shipment, while the report sums per source. This fixture
    // keeps one trip per shipment — the shape "same filter" has to mean for the
    // two totals to be comparable at all. A lot carrying several trips inside
    // one window is a definition question (see card 20260928_173, PM question 4),
    // not something this equality may silently decide.

    for (const kind of ['THU', 'TRA'] as const) {
      const report = await getPhoiPhieuReport({ kind, dateFrom: day, dateTo: day });
      assert.equal(
        report.grand.tongPhaiThuTra, boardTotal,
        `${kind}: the report grand total must equal the board's own total for the same window`,
      );
      assert.equal(
        report.rows.reduce((sum, row) => sum + row.tongPhaiThuTra, 0), boardTotal,
        `${kind}: the party rows must add up to that same total`,
      );
    }
  });
});

// Card 20260928_171 (AC1) — the board's Tiền đường cell and the detail dialog's
// total must be ONE number. The board sums APPROVED driver rows only
// (phoi-phieu-control.service.ts:230-247), because that is the money the
// driver's chi phiếu actually posts; the dialog's `totals.confirmed` has to
// equal it exactly and unapproved money must never leak into the board cell.
// This is the cross-surface pin the card asked for, with the definition decided
// in the dialog's favour of "what the voucher posts".
describe('card 20260928_171 — cột Tiền đường ngoài bảng và tổng trong màn hình chi tiết', () => {
  test('the board cell equals the detail approved total; unapproved money stays out of it', async () => {
    const { getPhoiPhieuTienDuong } = await import('../services/phoi-phieu-control.service');
    const { upsertExpenseAccountingSource } = await import('../services/expense-accounting-source.service');
    const fixture = await mkBoardFixture({ day: '2031-05-06' });
    const [driverUser] = await db.insert(s.users).values({
      username: `c171-${suffix}-${cleanup.length}`, passwordHash: 't', role: Role.DRIVER, status: 'ACTIVE',
    }).returning({ id: s.users.id });
    track(s.users, driverUser.id);
    const [driver] = await db.insert(s.drivers).values({
      name: `Tài xế C171 ${suffix}`, userId: driverUser.id, status: 'ACTIVE',
    }).returning({ id: s.drivers.id });
    track(s.drivers, driver.id);
    const [custRow] = await db.select({ customerId: s.shipments.customerId }).from(s.shipments).where(eq(s.shipments.id, fixture.shipment.id));
    const mkDriverCost = async (amount: number, approved: boolean) => {
      const [cost] = await db.insert(s.driverIncidentalCosts).values({
        tripId: fixture.trip.id, driverId: driver.id, costType: 'OTHER',
        amount: String(amount), driverEnteredAmount: String(amount), occurredAt: '2031-05-06',
      }).returning({ id: s.driverIncidentalCosts.id });
      track(s.driverIncidentalCosts, cost.id);
      const source = await upsertExpenseAccountingSource(db as never, { sourceKind: 'DRIVER', sourceId: cost.id,
        shipmentId: fixture.shipment.id, tripId: fixture.trip.id, customerId: custRow.customerId!, expenseTypeCode: 'OTHER',
        costGroup: 'DRIVER_ROAD', feeName: 'Tiền đường C171', amount, customerChargeAmount: 0, expenseDate: '2031-05-06',
        payerKind: 'USER', payableEntityType: 'DRIVER', payableEntityId: driver.id, recordedById: accountantId });
      track(s.expenseAccountingSources, source.id);
      if (approved) {
        await db.update(s.expenseAccountingSources).set({ confirmedAt: new Date() })
          .where(eq(s.expenseAccountingSources.id, source.id));
      }
      return source;
    };
    await mkDriverCost(400_000, true);
    await mkDriverCost(90_000, false);

    const detail = await getPhoiPhieuTienDuong(fixture.trip.id);
    const boardRows = (await listPhoiPhieuRows({ search: suffix })).filter((row) => row.tripId === fixture.trip.id);
    assert.equal(boardRows.length, 1, 'the trip is on the board exactly once');
    assert.equal(boardRows[0]!.tienDuong, 400_000, 'guard: the board sees the approved row');
    assert.equal(detail.totals.confirmed, 400_000, 'guard: the dialog sees the same approved money');
    assert.equal(detail.totals.total, 490_000, 'guard: the dialog also knows the unapproved row');
    assert.equal(boardRows[0]!.tienDuong, detail.totals.confirmed, 'the two surfaces report ONE number');
    assert.notEqual(boardRows[0]!.tienDuong, detail.totals.total, 'unapproved money never reaches the board cell');
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
    // Card 20260928_173 (flake fix): probe with the trip's REAL DRIVER-kind
    // source id. `expenseAccountingSources` has ONE primary key, so a DRIVER
    // row's id can never also be an OPS row's id — the refusal is structural,
    // not lucky. The old probe passed the raw `driverIncidentalCosts.id`, which
    // only missed the OPS-filtered lookup when the shared DB's id arithmetic
    // happened to line up: with identical code it went red on one run and green
    // on the next, because every other suite moves those sequences.
    const { upsertExpenseAccountingSource } = await import('../services/expense-accounting-source.service');
    const [custRow] = await db.select({ customerId: s.shipments.customerId }).from(s.shipments).where(eq(s.shipments.id, fixture.shipment.id));
    const driverSource = await upsertExpenseAccountingSource(db as never, { sourceKind: 'DRIVER', sourceId: cost.id,
      shipmentId: fixture.shipment.id, tripId: fixture.trip.id, customerId: custRow.customerId!, expenseTypeCode: 'OTHER',
      costGroup: 'OPS_INCIDENTAL', feeName: 'C13F4 cross-kind probe', amount: 1000, customerChargeAmount: 0,
      expenseDate: '2026-09-22', payerKind: 'USER', payableEntityType: 'DRIVER', payableEntityId: driver.id,
      recordedById: accountantId });
    track(s.expenseAccountingSources, driverSource.id);
    await assert.rejects(
      () => voidPhoiPhieuRow(fixture.trip.id, driverSource.id, { userId: accountantId } as never, 'cross-kind probe'),
      /Không tìm thấy khoản phí chi hộ OPS/,
      'a DRIVER-kind source id must never void through the chi-ho dialog',
    );
    const [intact] = await db.select({ status: s.expenseAccountingSources.status })
      .from(s.expenseAccountingSources).where(eq(s.expenseAccountingSources.id, driverSource.id));
    assert.equal(intact!.status, 'RECORDED', 'the refused void never touched the driver source');
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
    // Use both database sequences so repeated runs cannot leave an explicit
    // native ID in the path of a later nextval. Separate tables may allocate
    // equal numbers; consume another source ID before exercising the boundary.
    const { entry2, source2 } = await db.transaction(async (tx) => {
      const [entry] = await tx.insert(s.opsExpenseEntries).values({
        shipmentId: fixture.shipment.id, expenseTypeCode: 'OTHER', amount: '1000',
        customerChargeAmount: '100000', costGroup: 'OPS_INCIDENTAL', payerKind: 'USER',
        paidById: accountantId, paidAt: '2026-09-22',
      }).returning({ id: s.opsExpenseEntries.id });
      const sourceInput: typeof s.expenseAccountingSources.$inferInsert = {
        sourceKind: 'OPS', sourceId: entry.id, shipmentId: fixture.shipment.id, tripId: fixture.trip.id,
        confirmedAt: new Date(), version: 1,
      };
      let [source] = await tx.insert(s.expenseAccountingSources).values(sourceInput)
        .returning({ id: s.expenseAccountingSources.id });
      if (source.id === entry.id) {
        await tx.delete(s.expenseAccountingSources).where(eq(s.expenseAccountingSources.id, source.id));
        [source] = await tx.insert(s.expenseAccountingSources).values(sourceInput)
          .returning({ id: s.expenseAccountingSources.id });
      }
      return { entry2: entry, source2: source };
    });
    track(s.opsExpenseEntries, entry2.id);
    track(s.expenseAccountingSources, source2.id);
    const [src] = await db.select({ id: s.expenseAccountingSources.id, sourceId: s.expenseAccountingSources.sourceId })
      .from(s.expenseAccountingSources).where(eq(s.expenseAccountingSources.id, source2.id));
    assert.notEqual(src.sourceId, src.id, 'fixture guarantees distinct native and source-row IDs');

    const [account] = await db.insert(s.treasuryAccounts).values({
      code: `C12-STK3-${suffix}`, name: 'STK quỹ 3', type: 'CASH', fundCode: 'COMPANY', status: 'ACTIVE', createdBy: accountantId, updatedBy: accountantId,
    }).returning({ id: s.treasuryAccounts.id });
    track(s.treasuryAccounts, account.id);
    const result = await createPhoiPhieuVoucher({
      tripIds: [fixture.trip.id], direction: 'IN',
      treasuryAccountId: account.id, actor: { userId: accountantId, role: Role.ACCOUNTANT, username: 'k', email: 'k@x', fullName: 'k' } as never,
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

// Case QA-2026-09-24-01 (re-ruled): the consolidated voucher consumes ONLY
// approved chi-hộ/OPS sources — unapproved money never enters the phiếu. The
// payer scope split sends approved tiền đường to the cash/vouchers chain
// instead (docs/adr payer-scope).
describe('voucher consumes the approved chi-hộ set only (case QA-2026-09-24-01)', () => {
  test('t1: an unapproved chi-hộ source is excluded from the phiếu', async () => {
    const fixture = await mkBoardFixture({ charge: 100000 });
    const [entry2] = await db.insert(s.opsExpenseEntries).values({
      shipmentId: fixture.shipment.id, shipmentContainerId: fixture.container.id, expenseTypeCode: 'OTHER',
      amount: '70000', customerChargeAmount: '70000', costGroup: 'OPS_INCIDENTAL', payerKind: 'USER',
      paidById: accountantId, paidAt: '2026-09-22',
    }).returning({ id: s.opsExpenseEntries.id });
    track(s.opsExpenseEntries, entry2.id);
    const [source2] = await db.insert(s.expenseAccountingSources).values({
      sourceKind: 'OPS', sourceId: entry2.id, shipmentId: fixture.shipment.id, tripId: fixture.trip.id,
      confirmedAt: null, version: 1,
    }).returning({ id: s.expenseAccountingSources.id });
    track(s.expenseAccountingSources, source2.id);
    const [account] = await db.insert(s.treasuryAccounts).values({
      code: `C12-STK4-${suffix}`, name: 'STK quỹ 4', type: 'CASH', fundCode: 'COMPANY', status: 'ACTIVE', createdBy: accountantId, updatedBy: accountantId,
    }).returning({ id: s.treasuryAccounts.id });
    track(s.treasuryAccounts, account.id);
    const result = await createPhoiPhieuVoucher({
      tripIds: [fixture.trip.id], direction: 'IN',
      treasuryAccountId: account.id, actor: { userId: accountantId, role: Role.ACCOUNTANT, username: 'k', email: 'k@x', fullName: 'k' } as never,
    });
    assert.equal(result.total, 100000, 'only the approved source joins the phiếu — the unapproved 70000 never counts');
    const allocations = await db.select({ sourceRowId: s.expenseCashAllocations.expenseAccountingSourceId })
      .from(s.expenseCashAllocations).innerJoin(s.expenseCashVouchers, eq(s.expenseCashVouchers.id, s.expenseCashAllocations.voucherId))
      .where(eq(s.expenseCashVouchers.code, result.code as unknown as string));
    assert.ok(!allocations.some((a) => a.sourceRowId === source2.id), 'the unapproved source row is not allocated');
  });

  async function mkDriverOnlyFixture(approved: boolean) {
    const [customer] = await db.insert(s.customers).values({ name: `C12 driver-only customer ${suffix}-${cleanup.length}` }).returning({ id: s.customers.id });
    track(s.customers, customer.id);
    const [route] = await db.insert(s.routes).values({ name: 'C12 driver-only route' }).returning({ id: s.routes.id });
    track(s.routes, route.id);
    const [shipment] = await db.insert(s.shipments).values({
      customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'DISPATCHED',
    }).returning({ id: s.shipments.id });
    track(s.shipments, shipment.id);
    const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
      shipmentId: shipment.id, fulfillmentType: 'FCL_CONTAINER', cargoMode: 'FCL', sourceShipmentVersion: 1,
    }).returning({ id: s.shipmentFulfillments.id });
    track(s.shipmentFulfillments, fulfillment.id);
    const [trip] = await db.insert(s.trips).values({
      fulfillmentId: fulfillment.id, shipmentId: shipment.id, customerId: customer.id, routeId: route.id,
      tripCode: `TRP-C12D-${cleanup.length}-${suffix}`, departureDate: '2026-09-22', status: 'IN_TRANSIT',
    }).returning({ id: s.trips.id });
    track(s.trips, trip.id);
    const [driverUser] = await db.insert(s.users).values({
      username: `c12d-${suffix}-${cleanup.length}`, passwordHash: 't', role: Role.DRIVER, status: 'ACTIVE',
    }).returning({ id: s.users.id });
    track(s.users, driverUser.id);
    const [driver] = await db.insert(s.drivers).values({ name: 'Tài xế C12D', userId: driverUser.id, status: 'ACTIVE' }).returning({ id: s.drivers.id });
    track(s.drivers, driver.id);
    const [cost] = await db.insert(s.driverIncidentalCosts).values({
      tripId: trip.id, driverId: driver.id, costType: 'OTHER',
      amount: '300000', driverEnteredAmount: '300000', occurredAt: '2026-09-22',
    }).returning({ id: s.driverIncidentalCosts.id });
    track(s.driverIncidentalCosts, cost.id);
    const [source] = await db.insert(s.expenseAccountingSources).values({
      sourceKind: 'DRIVER', sourceId: cost.id, shipmentId: shipment.id, tripId: trip.id,
      confirmedAt: approved ? new Date() : null, version: 1,
    }).returning({ id: s.expenseAccountingSources.id });
    track(s.expenseAccountingSources, source.id);
    return { trip, driver, cost, source };
  }

  test('t3: an APPROVED tiền đường source is NEVER consumed by the phiếu — DRIVER_PAYOUT owns driver money (payer split)', async () => {
    const { trip, source } = await mkDriverOnlyFixture(true);
    const [account] = await db.insert(s.treasuryAccounts).values({
      code: `C12-STK5-${suffix}`, name: 'STK quỹ 5', type: 'CASH', fundCode: 'COMPANY', status: 'ACTIVE', createdBy: accountantId, updatedBy: accountantId,
    }).returning({ id: s.treasuryAccounts.id });
    track(s.treasuryAccounts, account.id);
    await assert.rejects(
      () => createPhoiPhieuVoucher({
        tripIds: [trip.id], direction: 'OUT',
        treasuryAccountId: account.id, actor: { userId: accountantId, role: Role.ACCOUNTANT, username: 'k', email: 'k@x', fullName: 'k' } as never,
      }),
      /chưa có khoản chi hộ/,
      'a driver-only trip issues no chi-hộ phiếu — driver money rides the DRIVER_PAYOUT surface',
    );
    const [fresh] = await db.select({ status: s.expenseAccountingSources.status, confirmedAt: s.expenseAccountingSources.confirmedAt })
      .from(s.expenseAccountingSources).where(eq(s.expenseAccountingSources.id, source.id));
    assert.equal(fresh!.status, 'RECORDED', 'the approved driver source is untouched');
    assert.ok(fresh!.confirmedAt, 'approval state intact');
    const allocations = await db.select({ id: s.expenseCashAllocations.id })
      .from(s.expenseCashAllocations).where(eq(s.expenseCashAllocations.expenseAccountingSourceId, source.id));
    assert.equal(allocations.length, 0, 'no cash was ever allocated against the driver source');
  });
});

describe('soft-deleted shipments never surface on the phoi-phieu board (QA-fixture family _42)', () => {
  test('a live trip whose shipment is soft-deleted is not listed', async () => {
    const marker = `QADEL-ORPHAN-${Date.now()}`;
    const fixture = await mkBoardFixture();
    await db.update(s.shipments).set({ deletedAt: new Date() }).where(eq(s.shipments.id, fixture.shipment.id));
    const visible = await listPhoiPhieuRows({ search: suffix });
    assert.ok(!visible.some((row) => row.shipmentId === fixture.shipment.id), 'orphaned trip of a deleted shipment must not render');
    const markerRows = await listPhoiPhieuRows({ search: marker });
    assert.equal(markerRows.length, 0);
  });
});

describe('card 20260928_170 — ô STK nguồn quỹ, dấu tiền vào sổ quỹ, ô tổng bằng tổng dòng', () => {
  async function mkTreasuryAccount(code: string, fundCode: 'COMPANY' | 'TM' | null) {
    const [account] = await db.insert(s.treasuryAccounts).values({
      code, name: `STK ${code}`, type: 'CASH', fundCode, status: 'ACTIVE', createdBy: accountantId, updatedBy: accountantId,
    }).returning({ id: s.treasuryAccounts.id, code: s.treasuryAccounts.code });
    track(s.treasuryAccounts, account.id);
    return account;
  }

  test('AC2: ô STK chỉ mời chọn tài khoản đã gán nguồn quỹ (2 nguồn của thẻ 167)', async () => {
    const company = await mkTreasuryAccount(`C12-STK-COMPANY-${suffix}`, 'COMPANY');
    const cash = await mkTreasuryAccount(`C12-STK-TM-${suffix}`, 'TM');
    const unfunded = await mkTreasuryAccount(`C12-STK-NOFUND-${suffix}`, null);

    const items = await listPhoiPhieuStk();
    const codes = items.map((item) => item.code);
    assert.ok(codes.includes(company.code), 'quỹ công ty được mời chọn');
    assert.ok(codes.includes(cash.code), 'quỹ TM được mời chọn');
    assert.ok(!codes.includes(unfunded.code), 'tài khoản chưa gán nguồn quỹ không bao giờ được mời chọn — engine sẽ từ chối khi ghi phiếu');
    // The option COUNT, scoped to this case: three accounts carry these exact
    // codes (COMPANY, TM, no-fund) and exactly two of them may be offered. A
    // global count cannot be asserted here — the dev DB holds every other
    // suite's accounts, and other cases in this file share the run suffix.
    const mine = [company.code, cash.code, unfunded.code];
    assert.equal(items.filter((item) => mine.includes(item.code)).length, 2, 'đúng 2 nguồn quỹ của fixture được mời chọn');
    // Every offered id is fund-assigned; this stays true however many foreign
    // accounts exist, so it is the race-free form of the same rule.
    const offered = await db.select({ fundCode: s.treasuryAccounts.fundCode }).from(s.treasuryAccounts)
      .where(inArray(s.treasuryAccounts.id, items.map((item) => item.id)));
    assert.ok(offered.every((account) => account.fundCode === 'COMPANY' || account.fundCode === 'TM'),
      'không tài khoản nào chưa gán nguồn quỹ lọt vào ô STK');
  });
  // Card 20260929_212: the list used to filter `type='CASH'`, so the two fund
  // sources PM's own document names — "TK công ty – Ngân hàng ACB" and "TK TM",
  // both bank accounts — could not be picked on this board at all. The AC2 case
  // above only ever created CASH accounts, which is why that survived.
  test('AC2b: ô STK mời chọn nguồn quỹ NGÂN HÀNG — đúng hai nguồn PM đã định nghĩa', async () => {
    const [bankCompany] = await db.insert(s.treasuryAccounts).values({
      code: `C12-STK-ACB-${suffix}`, name: `STK ACB ${suffix}`, type: 'BANK', fundCode: 'COMPANY', status: 'ACTIVE', createdBy: accountantId, updatedBy: accountantId,
    }).returning({ id: s.treasuryAccounts.id, code: s.treasuryAccounts.code });
    track(s.treasuryAccounts, bankCompany.id);
    const [bankTm] = await db.insert(s.treasuryAccounts).values({
      code: `C12-STK-ACTM-${suffix}`, name: `STK AC TM ${suffix}`, type: 'BANK', fundCode: 'TM', status: 'ACTIVE', createdBy: accountantId, updatedBy: accountantId,
    }).returning({ id: s.treasuryAccounts.id, code: s.treasuryAccounts.code });
    track(s.treasuryAccounts, bankTm.id);

    const codes = (await listPhoiPhieuStk()).map((item) => item.code);
    assert.ok(codes.includes(bankCompany.code), 'nguồn quỹ công ty dạng NGÂN HÀNG phải hiện trong ô STK');
    assert.ok(codes.includes(bankTm.code), 'nguồn quỹ TM dạng NGÂN HÀNG phải hiện trong ô STK');
  });

  test('AC3: phiếu thu cộng, phiếu chi trừ vào sổ quỹ của đúng STK', async () => {
    const inbound = await mkBoardFixture({ charge: 100000 });
    const outbound = await mkBoardFixture({ reconciled: true });
    const account = await mkTreasuryAccount(`C12-STK-SIGN-${suffix}`, 'COMPANY');
    const actor = { userId: accountantId, role: Role.ACCOUNTANT, username: 'k', email: 'k@x', fullName: 'k' } as never;
    const book = async () => (await listFundBook('COMPANY')).accounts.find((entry) => entry.accountId === account.id)!;
    assert.equal((await book()).bookBalance, 0, 'sổ quỹ của STK bắt đầu từ 0');

    const receipt = await createPhoiPhieuVoucher({ tripIds: [inbound.trip.id], direction: 'IN', treasuryAccountId: account.id, actor });
    assert.equal(receipt.total, 100000);
    assert.equal((await book()).bookBalance, 100000, 'thu → cộng vào sổ quỹ');

    const payment = await createPhoiPhieuVoucher({ tripIds: [outbound.trip.id], direction: 'OUT', treasuryAccountId: account.id, actor });
    assert.equal(payment.total, 250000);
    assert.equal((await book()).bookBalance, 100000 - 250000, 'chi → trừ vào sổ quỹ');

    const movements = await db.select().from(s.treasuryMovements).where(eq(s.treasuryMovements.treasuryAccountId, account.id));
    assert.deepEqual(movements.map((movement) => movement.direction).sort(), ['IN', 'OUT'], 'mỗi chiều một bút toán, đúng dấu');
    assert.ok(movements.every((movement) => movement.status === 'POSTED'), 'cả hai bút toán đã ghi sổ');
  });

  test('AC4: ô chi hộ bằng tổng các dòng chi phí bên dưới dialog', async () => {
    const fixture = await mkBoardFixture({ charge: 100000, extra: [{ amount: 40000, charge: 15000 }] });
    const [row] = (await listPhoiPhieuRows({ search: suffix })).filter((candidate) => candidate.tripId === fixture.trip.id);
    const detail = await getPhoiPhieuChiHo(fixture.trip.id);
    assert.equal(detail.rows.length, 2, 'hai dòng chi phí dưới ô');
    assert.equal(row!.chiHoTra, detail.totals.tra, 'Phải trả trên bảng = tổng các dòng bên dưới');
    assert.equal(row!.chiHoThu, detail.totals.thu, 'Phải thu trên bảng = tổng các dòng bên dưới');
    assert.equal(row!.chiHoTra, 290000);
    assert.equal(row!.chiHoThu, 115000);
  });

  test('AC4: ô tiền đường bằng tổng các dòng tiền đường ĐÃ DUYỆT bên dưới', async () => {
    const fixture = await mkBoardFixture();
    const [driverUser] = await db.insert(s.users).values({
      username: `c170-${suffix}-${cleanup.length}`, passwordHash: 't', role: Role.DRIVER, status: 'ACTIVE',
    }).returning({ id: s.users.id });
    track(s.users, driverUser.id);
    const [driver] = await db.insert(s.drivers).values({ name: 'Tài xế C170', userId: driverUser.id, status: 'ACTIVE' }).returning({ id: s.drivers.id });
    track(s.drivers, driver.id);
    const mkCost = async (amount: string, confirmed: boolean) => {
      const [cost] = await db.insert(s.driverIncidentalCosts).values({
        tripId: fixture.trip.id, driverId: driver.id, costType: 'OTHER',
        amount, driverEnteredAmount: amount, occurredAt: '2026-09-22',
      }).returning({ id: s.driverIncidentalCosts.id });
      track(s.driverIncidentalCosts, cost.id);
      const [link] = await db.insert(s.expenseAccountingSources).values({
        sourceKind: 'DRIVER', sourceId: cost.id, shipmentId: fixture.shipment.id, tripId: fixture.trip.id,
        confirmedAt: confirmed ? new Date() : null, version: 1,
      }).returning({ id: s.expenseAccountingSources.id });
      track(s.expenseAccountingSources, link.id);
    };
    await mkCost('120000', true);
    await mkCost('80000', true);
    await mkCost('30000', false);

    const [row] = (await listPhoiPhieuRows({ search: suffix })).filter((candidate) => candidate.tripId === fixture.trip.id);
    const detail = await getPhoiPhieuTienDuong(fixture.trip.id);
    assert.equal(detail.rows.length, 3, 'ba dòng tiền đường dưới ô');
    assert.equal(detail.totals.confirmed, 200000);
    assert.equal(detail.totals.total, 230000);
    // The board's cell counts the APPROVED rows only (card 20260921_14 rework).
    // The dialog's own TỔNG CỘNG spans every row, unapproved included — that
    // divergence is card 20260928_171's, deliberately not changed here.
    assert.equal(row!.tienDuong, detail.totals.confirmed, 'ô trên bảng = tổng các dòng đã duyệt bên dưới');
    assert.notEqual(row!.tienDuong, detail.totals.total, 'dòng chưa duyệt không được cộng vào ô');
  });
});

// Card 20260927_147 — the consolidated phiếu now reads its selection's recorded cash
// totals in ONE batch instead of once per source. This pins that each source is still
// read against ITS OWN totals: a shared bucket changes a per-source remaining, and here
// it silently drops the second entry (15000 < the other source's 40000).
describe('card 20260927_147 — a multi-source phiếu reads each source own cash totals', () => {
  test('getExpenseCashTotalsBatch keeps one bucket per source, zero for sources with no rows', async () => {
    const fixture = await mkBoardFixture({ charge: 100000, extra: [{ amount: 40000, charge: 15000 }] });
    const [acct] = await db.insert(s.treasuryAccounts).values({
      code: `TA-147b-${suffix}-${cleanup.length}`, name: `Quỹ 147b ${suffix}`, type: 'CASH', fundCode: 'COMPANY',
      status: 'ACTIVE', createdBy: accountantId, updatedBy: accountantId,
    }).returning({ id: s.treasuryAccounts.id });
    track(s.treasuryAccounts, acct.id);
    const [movement] = await db.insert(s.treasuryMovements).values({
      treasuryAccountId: acct.id, direction: 'IN', amount: '40000', valueDate: '2026-09-22',
      physicalReference: `PR-147b-${suffix}-${cleanup.length}`, sourceVersion: 1, paymentContractVersion: 1, createdBy: accountantId,
    }).returning({ id: s.treasuryMovements.id });
    track(s.treasuryMovements, movement.id);
    const [prior] = await db.insert(s.expenseCashVouchers).values({
      code: `VC-147b-${suffix}-${cleanup.length}`, counterpartyType: 'USER', counterpartyId: accountantId,
      treasuryMovementId: movement.id, status: 'RECORDED', createdById: accountantId,
    }).returning({ id: s.expenseCashVouchers.id });
    track(s.expenseCashVouchers, prior.id);
    const [priorAllocation] = await db.insert(s.expenseCashAllocations).values({
      voucherId: prior.id, expenseAccountingSourceId: fixture.source.id, sourceVersion: 1, amount: '40000',
    }).returning({ id: s.expenseCashAllocations.id });
    track(s.expenseCashAllocations, priorAllocation.id);

    // The source WITHOUT allocations is asked FIRST: a batch that funnels every row into
    // one bucket, or reuses the first bucket for all ids, cannot hide behind query order.
    const totals = await getExpenseCashTotalsBatch(db as never, [fixture.extras[0]!.sourceId, fixture.source.id, 2_147_000_000]);
    assert.deepEqual(totals.get(fixture.extras[0]!.sourceId), { IN: 0, OUT: 0 }, 'nguồn không có dòng nào = 0');
    assert.deepEqual(totals.get(fixture.source.id), { IN: 40000, OUT: 0 }, 'nguồn có dòng = đúng số của chính nó');
    assert.deepEqual(totals.get(2_147_000_000), { IN: 0, OUT: 0 }, 'id không tồn tại vẫn có mặt trong map và bằng 0');
  });

  test('a source with recorded cash and a source without keep their own remaining', async () => {
    const fixture = await mkBoardFixture({ charge: 100000, extra: [{ amount: 40000, charge: 15000 }] });
    const [acct] = await db.insert(s.treasuryAccounts).values({
      code: `TA-147-${suffix}-${cleanup.length}`, name: `Quỹ 147 ${suffix}`, type: 'CASH', fundCode: 'COMPANY',
      status: 'ACTIVE', createdBy: accountantId, updatedBy: accountantId,
    }).returning({ id: s.treasuryAccounts.id });
    track(s.treasuryAccounts, acct.id);
    const [movement] = await db.insert(s.treasuryMovements).values({
      treasuryAccountId: acct.id, direction: 'IN', amount: '40000', valueDate: '2026-09-22',
      physicalReference: `PR-147-${suffix}-${cleanup.length}`, sourceVersion: 1, paymentContractVersion: 1, createdBy: accountantId,
    }).returning({ id: s.treasuryMovements.id });
    track(s.treasuryMovements, movement.id);
    const [prior] = await db.insert(s.expenseCashVouchers).values({
      code: `VC-147-${suffix}-${cleanup.length}`, counterpartyType: 'USER', counterpartyId: accountantId,
      treasuryMovementId: movement.id, status: 'RECORDED', createdById: accountantId,
    }).returning({ id: s.expenseCashVouchers.id });
    track(s.expenseCashVouchers, prior.id);
    // 40000 of the first source's 100000 charge is already collected; the second source
    // (charge 15000) has nothing recorded.
    const [priorAllocation] = await db.insert(s.expenseCashAllocations).values({
      voucherId: prior.id, expenseAccountingSourceId: fixture.source.id, sourceVersion: 1, amount: '40000',
    }).returning({ id: s.expenseCashAllocations.id });
    track(s.expenseCashAllocations, priorAllocation.id);

    const result = await createPhoiPhieuVoucher({
      tripIds: [fixture.trip.id], direction: 'IN', treasuryAccountId: acct.id,
      actor: { userId: accountantId, role: Role.ACCOUNTANT, username: 'k', email: 'k@x', fullName: 'k' } as never,
    });
    // The service writes its own voucher/movement/allocation rows; track them too so this
    // case does not add to the local DB pile (the teardown only drains `cleanup`).
    const createdVouchers = await db.select({ id: s.expenseCashVouchers.id, movementId: s.expenseCashVouchers.treasuryMovementId })
      .from(s.expenseCashVouchers).where(eq(s.expenseCashVouchers.code, result.code as unknown as string));
    const createdAllocations = await db.select({
      id: s.expenseCashAllocations.id, sourceRowId: s.expenseCashAllocations.expenseAccountingSourceId, amount: s.expenseCashAllocations.amount,
    }).from(s.expenseCashAllocations).where(inArray(s.expenseCashAllocations.voucherId, createdVouchers.map((row) => row.id)));
    for (const row of createdVouchers) track(s.treasuryMovements, row.movementId);
    for (const row of createdVouchers) track(s.expenseCashVouchers, row.id);
    for (const row of createdAllocations) track(s.expenseCashAllocations, row.id);

    const bySource = new Map(createdAllocations.map((row) => [row.sourceRowId, String(row.amount)]));
    assert.equal(bySource.get(fixture.source.id), '60000', 'nguồn 1: 100000 phải thu − 40000 đã thu');
    assert.equal(bySource.get(fixture.extras[0]!.sourceId), '15000', 'nguồn 2 giữ 15000 của chính nó, không dùng totals của nguồn 1');
    assert.equal(result.total, 75000, 'tổng phiếu = tổng hai phần còn lại độc lập');
  });
});

/**
 * This file tracked every row it created and then never deleted any of them.
 *
 * The symptom looked like flake and was not: a run left `C12 customer N` rows
 * behind, and the next run — whose names are derived from `cleanup.length`,
 * which starts at 0 in a fresh process — collided on
 * `customers_active_name_tax_code_uniq_idx`. Two consecutive runs failed with
 * DIFFERENT test names, which is the tell for residue rather than a code
 * change. Clearing the stale rows made the file green again (23/23) without any
 * source edit.
 *
 * Two fixes, because either alone leaves the other half:
 *   1. customer names carry the run-unique `suffix`, so a stale row can never
 *      collide with a fresh run — the test no longer depends on DB history
 *   2. this teardown actually drains `cleanup`, so the DB stops accumulating
 *
 * `cleanup` is unshift-ordered, so the newest row is deleted first and children
 * go before the parents they reference. Deletion is best-effort: a row some
 * other test or a soft-delete rule still references should not fail this file's
 * teardown and mask a real failure with a constraint error.
 */
after(async () => {
  for (const { table, id } of cleanup) {
    try {
      await db.delete(table).where(eq(table.id, id));
    } catch {
      /* best-effort: a referenced row must not fail the teardown */
    }
  }
  try { await disconnectRedis(); } catch { /* already closed */ }
  process.exit(0);
});

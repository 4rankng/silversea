// SIL-1109 — đóng cửa sổ race số hóa đơn trùng (follow-up SIL-1101, P3).
//
// Guard SIL-1101 là check-then-insert: hai request ĐỒNG THỜI với cùng số HĐ
// sau khi fold (' QA-1109-X ' ≡ 'qa-1109-x') trên HAI LÔ khác nhau từng có thể
// cùng chèn thành công → hai nghĩa vụ thanh toán cho một chứng từ. Cửa sổ đó
// được khóa bằng pg_advisory_xact_lock theo số đã fold (mọi guarded lane chạy
// trong transaction của caller) + 4 partial unique expression index ở tầng DB
// (migration 20261127100000_sil1109_invoice_number_unique).
//
// Fixture mirrors sil1100-advance-aware-gate.test.ts (real dev DB; cleanup is
// suffix-pattern based so an assertion failure mid-race still sweeps every
// service-created row). Mỗi bảng trong 4 store chạy đúng một kịch bản chấp thuận:
// Promise.allSettled của 2 create-lane call cùng số HĐ chuẩn hóa, khác lô →
// ĐÚNG 1 request thành công, request kia bị chặn 400 với đúng thông điệp
// tiếng Việt hiện có (gọi tên số + lô), không lộ text DB.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray, sql } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { DriverIncidentalCostType, Role, type ExpenseAccountingCreate } from '@tingting/shared';
import { disconnectRedis } from '../lib/redis';
import { ApiError } from '../errors';
import { createAccountingExpense } from '../services/expense-accounting-create.service';
import { createInvoiceTracking } from '../services/invoice-tracking.service';
import type { ExpenseActor } from '../services/expense-accounting-write.service';

const DAY = '2026-11-27';
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

interface Fixture {
  adminId: number;
  typeCode: string;
  supplierId: number;
  lots: Array<{ id: number; code: string }>;
  trips: Array<{ id: number; code: string }>;
}

async function mkFixture(): Promise<Fixture> {
  const tag = suffix;
  const [admin] = await db.insert(s.users).values({
    username: `sil1109-${tag}`, passwordHash: 't', role: Role.ADMIN, status: 'ACTIVE',
  }).returning({ id: s.users.id });
  const [customer] = await db.insert(s.customers).values({ name: `SIL1109 customer ${tag}` })
    .returning({ id: s.customers.id });
  const [route] = await db.insert(s.routes).values({ name: `SIL1109 route ${tag}` }).returning({ id: s.routes.id });
  const [supplier] = await db.insert(s.suppliers).values({ name: `SIL1109 supplier ${tag}` })
    .returning({ id: s.suppliers.id });
  const [type] = await db.insert(s.forwarderExpenseTypes).values({
    code: `SIL1109-${tag}`, name: `SIL1109 loại phí ${tag}`, status: 'ACTIVE',
  }).returning({ id: s.forwarderExpenseTypes.id, code: s.forwarderExpenseTypes.code });
  const [driver] = await db.insert(s.drivers).values({
    name: `SIL1109 lái xe ${tag}`, status: 'ACTIVE',
  }).returning({ id: s.drivers.id });
  const lots: Fixture['lots'] = [];
  const trips: Fixture['trips'] = [];
  for (const lotIndex of [1, 2]) {
    const [shipment] = await db.insert(s.shipments).values({
      shipmentCode: `SIL1109-LOT${lotIndex}-${tag}`, customerId: customer.id, routeId: route.id,
      cargoMode: 'FCL', status: 'DISPATCHED', expectedDeliveryDate: DAY,
    }).returning({ id: s.shipments.id, code: s.shipments.shipmentCode });
    const [trip] = await db.insert(s.trips).values({
      tripCode: `SIL1109-T${lotIndex}-${tag}`, customerId: customer.id, routeId: route.id,
      shipmentId: shipment.id, driverId: driver.id, status: 'CREATED', departureDate: DAY,
    }).returning({ id: s.trips.id, code: s.trips.tripCode });
    lots.push({ id: shipment.id, code: shipment.code ?? `#${shipment.id}` });
    trips.push({ id: trip.id, code: trip.code ?? `#${trip.id}` });
  }
  return { adminId: admin.id, typeCode: type.code, supplierId: supplier.id, lots, trips };
}

let fxPromise: Promise<Fixture> | undefined;
function fixture(): Promise<Fixture> {
  return (fxPromise ??= mkFixture());
}

const actor = (fixture_: Fixture): ExpenseActor => ({ userId: fixture_.adminId, role: Role.ADMIN });

/** The two racing creation calls: same folded number (' QA… ' vs 'qa…'), two lots. */
const raceNumbers = (stem: string): [string, string] => [` QA-${stem} `, `qa-${stem.toLowerCase()}`];

async function expectExactlyOneRefusal<T>(
  lane: string,
  pair: [Promise<unknown>, Promise<unknown>],
  holderLotCodes: readonly [string, string],
  raceNumbers_: readonly [string, string],
): Promise<T> {
  const settled = await Promise.allSettled(pair);
  const fulfilled = settled.filter((r): r is PromiseFulfilledResult<unknown> => r.status === 'fulfilled');
  const rejected = settled.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  assert.equal(fulfilled.length, 1, `${lane}: đúng một request thắng race`);
  assert.equal(rejected.length, 1, `${lane}: request kia bị chặn`);
  const reason = rejected[0].reason;
  assert.ok(reason instanceof ApiError, `${lane}: phải là ApiError, nhận được ${String(reason)}`);
  assert.equal(reason.statusCode, 400, `${lane}: chặn bằng 400 như guard hiện có`);
  assert.match(reason.message, /đã tồn tại trên lô /, `${lane}: message tiếng Việt giữ nguyên luật SIL-1101`);
  assert.ok(
    holderLotCodes.some((code) => reason.message.includes(code)),
    `${lane}: message gọi đúng lô đang giữ số (${reason.message})`,
  );
  assert.ok(
    raceNumbers_.some((n) => reason.message.includes(n)),
    `${lane}: message gọi đúng số hóa đơn thắng race (${reason.message})`,
  );
  assert.ok(!/regexp_replace|already exists|Key \(/.test(reason.message), `${lane}: không lộ text DB`);
  return fulfilled[0].value as T;
}

function lotExpenseInput(fixture_: Fixture, lotIndex: 0 | 1, invoiceNumber: string, lane: {
  costGroup: ExpenseAccountingCreate['costGroup'];
  payerKind: ExpenseAccountingCreate['payerKind'];
  driverCostType?: ExpenseAccountingCreate['driverCostType'];
}): ExpenseAccountingCreate {
  return {
    shipmentId: fixture_.lots[lotIndex].id,
    tripId: fixture_.trips[lotIndex].id,
    expenseTypeCode: fixture_.typeCode,
    amount: 50000,
    customerChargeAmount: 0,
    expenseDate: DAY,
    costGroup: lane.costGroup,
    feeName: `SIL1109 phí ${invoiceNumber}`,
    invoiceNumber,
    payerKind: lane.payerKind,
    supplierId: lane.payerKind === 'SUPPLIER' ? fixture_.supplierId : undefined,
    driverCostType: lane.driverCostType,
  };
}

after(async () => {
  // Pattern cleanup keyed by the run's unique suffix — survives assertion
  // failures mid-test (per-row tracking misses untracked service-created
  // rows when a race assertion throws before bookkeeping).
  const lots = await db.select({ id: s.shipments.id })
    .from(s.shipments).where(sql`${s.shipments.shipmentCode} like ${'%-' + suffix}`);
  const lotIds = lots.map((l) => l.id);
  const trips = await db.select({ id: s.trips.id })
    .from(s.trips).where(sql`${s.trips.tripCode} like ${'%-' + suffix}`);
  const tripIds = trips.map((t) => t.id);
  if (lotIds.length) {
    await db.delete(s.expenseAccountingSources).where(inArray(s.expenseAccountingSources.shipmentId, lotIds));
    await db.delete(s.opsExpenseEntries).where(inArray(s.opsExpenseEntries.shipmentId, lotIds));
    await db.delete(s.invoiceTracking).where(inArray(s.invoiceTracking.shipmentId, lotIds));
  }
  if (tripIds.length) {
    await db.delete(s.tripExpenses).where(inArray(s.tripExpenses.tripId, tripIds));
    await db.delete(s.driverIncidentalCosts).where(inArray(s.driverIncidentalCosts.tripId, tripIds));
  }
  await db.delete(s.trips).where(inArray(s.trips.id, tripIds));
  await db.delete(s.shipments).where(inArray(s.shipments.id, lotIds));
  await db.delete(s.drivers).where(sql`${s.drivers.name} like ${'%-' + suffix}`);
  await db.delete(s.suppliers).where(sql`${s.suppliers.name} like ${'%-' + suffix}`);
  await db.delete(s.forwarderExpenseTypes).where(sql`${s.forwarderExpenseTypes.code} like ${'SIL1109-' + suffix + '-%'}`);
  await db.delete(s.routes).where(sql`${s.routes.name} like ${'%-' + suffix}`);
  await db.delete(s.customers).where(sql`${s.customers.name} like ${'%-' + suffix}`);
  await db.delete(s.users).where(sql`${s.users.username} like ${'sil1109-' + suffix + '%'}`);
  await disconnectRedis();
});

describe('SIL-1109 — race số hóa đơn trùng đóng ở tầng khóa/DB (BE)', () => {
  test('invoice_tracking: 2 tạo ĐỒNG THỜI cùng số trên 2 lô → 1 thành công, 1 bị 400', async () => {
    const fixture_ = await fixture();
    const [rawA, rawB] = raceNumbers(`it-${suffix}`);
    const create = (invoiceNumber: string, lotIndex: 0 | 1) => createInvoiceTracking(fixture_.adminId, {
      shipmentId: fixture_.lots[lotIndex].id,
      tripId: fixture_.trips[lotIndex].id,
      invoiceNumber,
      invoiceAmount: 1000000,
      supplierPayment: 900000,
      progress: 'CHUA_GUI',
    });
    const winner = await expectExactlyOneRefusal<{ id: number; invoiceNumber: string | null; expenseId: number | null }>(
      'invoice_tracking', [create(rawA, 0), create(rawB, 1)],
      [fixture_.lots[0].code, fixture_.lots[1].code], [rawA, rawB],
    );
    assert.ok(winner.invoiceNumber != null);
    assert.ok(winner.expenseId != null, 'winner vẫn tạo khoản chi Trả NCC mirror như hiện có');
  });

  test('ops_expense_entries (lô, không chuyến): 2 tạo ĐỒNG THỜI cùng số trên 2 lô → 1 thành công, 1 bị 400', async () => {
    const fixture_ = await fixture();
    const [rawA, rawB] = raceNumbers(`ops-${suffix}`);
    const input = (invoiceNumber: string, lotIndex: 0 | 1): ExpenseAccountingCreate => ({
      ...lotExpenseInput(fixture_, lotIndex, invoiceNumber, { costGroup: 'INVOICED_LIFT', payerKind: 'COMPANY' }),
      tripId: null,
    });
    const create = (invoiceNumber: string, lotIndex: 0 | 1) =>
      db.transaction((tx) => createAccountingExpense(tx, actor(fixture_), input(invoiceNumber, lotIndex)));
    const winner = await expectExactlyOneRefusal<{ sourceId: number }>(
      'ops_expense_entries', [create(rawA, 0), create(rawB, 1)],
      [fixture_.lots[0].code, fixture_.lots[1].code], [rawA, rawB],
    );
    assert.ok(winner.sourceId != null);
  });

  test('trip_expenses: 2 tạo ĐỒNG THỜI cùng số trên 2 chuyến/2 lô → 1 thành công, 1 bị 400', async () => {
    const fixture_ = await fixture();
    const [rawA, rawB] = raceNumbers(`trip-${suffix}`);
    const create = (invoiceNumber: string, lotIndex: 0 | 1) =>
      db.transaction((tx) => createAccountingExpense(tx, actor(fixture_), lotExpenseInput(
        fixture_, lotIndex, invoiceNumber, { costGroup: 'INVOICED_OTHER', payerKind: 'SUPPLIER' },
      )));
    const winner = await expectExactlyOneRefusal<{ sourceId: number }>(
      'trip_expenses', [create(rawA, 0), create(rawB, 1)],
      [fixture_.lots[0].code, fixture_.lots[1].code], [rawA, rawB],
    );
    assert.ok(winner.sourceId != null);
  });

  test('driver_incidental_costs: CR-011 §5.1.6 — cùng số HĐ trên 2 chuyến của lái xe là HỢP LỆ, guard không chặn (mỗi khoản render đúng 1 nơi)', async () => {
    const fixture_ = await fixture();
    const [rawA] = raceNumbers(`drv-${suffix}`);
    const create = (invoiceNumber: string, lotIndex: 0 | 1) =>
      db.transaction((tx) => createAccountingExpense(tx, actor(fixture_), lotExpenseInput(
        fixture_, lotIndex, invoiceNumber,
        { costGroup: 'DRIVER_SHIPMENT', payerKind: 'COMPANY', driverCostType: DriverIncidentalCostType.PER_DIEM },
      )));
    // Một hóa đơn giấy của lái xe trải nhiều chuyến — dữ liệu hợp lệ theo
    // CR-011 §5.1.6/§6.2 (pin phoi-phieu-tien-duong-separation). Cả hai ghi
    // nhận được; mỗi khoản render đúng một nơi ở hộp thoại tien-duong.
    const [a, b] = await Promise.all([create(rawA, 0), create(rawA, 1)]);
    assert.ok(a.sourceId != null, 'khoản chuyến 1 phải ghi nhận được');
    assert.ok(b.sourceId != null, 'khoản chuyến 2 phải ghi nhận được (khác chuyến, cùng số HĐ giấy)');
  });

  test('DB-level partial unique indexes exist on the three obligation stores (migration landed; driver store exempt per CR-011)', async () => {
    const indexNames = [
      'invoice_tracking_live_invoice_number_key',
      'trip_expenses_live_invoice_number_key',
      'ops_expense_entries_live_invoice_number_key',
    ];
    for (const name of indexNames) {
      const rows = await db.execute(sql`select 1 from pg_indexes where indexname = ${name}`);
      assert.ok(rows.length === 1, `missing index ${name} — chưa chạy migration SIL-1109`);
    }
    const dropped = await db.execute(sql`select 1 from pg_indexes where indexname = 'driver_incidental_costs_live_invoice_number_key'`);
    assert.ok(dropped.length === 0, 'driver index phải đã DROP — CR-011 cho phép cùng số HĐ trải nhiều chuyến');
  });
});

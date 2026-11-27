// SIL-1102 (K2.124, KB §2.4.8) — báo cáo thu (/phoi-phieu/report?kind=THU) phải
// thấy phiếu thu theo NGÀY GIÁ TRỊ của movement, không phải theo ngày departure
// của chuyến, và phải thấy khoản lái-xe khai (sourceKind DRIVER) — nguồn mà
// phiếu thu SIL-1099 lập được. Owner firsthand 27/11 (build 23a8fa17, ĐÃ chứa
// fix as-of wave5 cd9680e8+89884f71): phiếu CP-1-IN-PHOI-PHIEU-OPS:1-204,
// 300.000₫, valueDate 10/11 trên chuyến 204 (departure 20/12, khoản lái xe
// khai) → báo cáo THU với khoảng chứa 10/11 = 0₫ ở MỌI ngày.
// Hai couplings còn thiếu: (1) reportSources chỉ đọc OPS — nguồn DRIVER (khoản
// lái xe khai thu khách) không bao giờ vào báo cáo; (2) tiền ĐÃ THU bị chặn
// theo cửa sổ departureDate của chuyến — phiếu ngày giá trị 10/11 trên chuyến
// 20/12 không thuộc cửa sổ nào chứa 10/11. Luật mong đợi: báo cáo thu tính đến
// ngày X gồm MỌI phiếu có valueDate ≤ X; đảo phiếu ghi đúng ngày đảo, không
// xóa dấu vết phiếu gốc.
// Integration family (real dev DB, tracked cleanup) — same seam as
// sil1102-as-of-totals.test.ts.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

import { db } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { disconnectRedis } from '../lib/redis';
import { getPhoiPhieuReport } from '../services/phoi-phieu-control.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
type TrackedTable = PgTable & { id: PgColumn };
const cleanup: Array<{ table: TrackedTable; id: number }> = [];
function track(table: TrackedTable, id: number) {
  cleanup.unshift({ table, id });
}

after(async () => {
  for (const { table, id } of cleanup) await db.delete(table).where(eq(table.id, id));
  await disconnectRedis();
});

interface Fixture {
  adminId: number;
  customerId: number;
  customerName: string;
  tripId: number;
  sourceId: number;
  voucherId: number;
  movementId: number;
  accountId: number;
}

/** Chuyến 204 thật: departure 20/12, khoản DRIVER khai 300.000₫, phiếu thu
 *  valueDate 10/11 — ngày giá trị TRƯỚC departure 40 ngày. */
async function mkDriverLot(): Promise<Fixture> {
  const tag = `${suffix}-${cleanup.length}`;
  const [admin] = await db.insert(s.users).values({
    username: `sil1102rpt-${tag}`, passwordHash: 't', role: Role.ADMIN, status: 'ACTIVE',
  }).returning({ id: s.users.id });
  track(s.users, admin.id);
  const customerName = `SIL1102 rpt customer ${tag}`;
  const [customer] = await db.insert(s.customers).values({ name: customerName })
    .returning({ id: s.customers.id });
  track(s.customers, customer.id);
  const [route] = await db.insert(s.routes).values({ name: `SIL1102 rpt route ${tag}` }).returning({ id: s.routes.id });
  track(s.routes, route.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'DISPATCHED', expectedDeliveryDate: '2026-12-20',
  }).returning({ id: s.shipments.id });
  track(s.shipments, shipment.id);
  const [trip] = await db.insert(s.trips).values({
    customerId: customer.id, routeId: route.id, shipmentId: shipment.id,
    status: 'IN_TRANSIT', departureDate: '2026-12-20',
  }).returning({ id: s.trips.id });
  track(s.trips, trip.id);
  const [driverCost] = await db.insert(s.driverIncidentalCosts).values({
    tripId: trip.id, driverId: admin.id, costType: 'OTHER', amount: '300000',
    occurredAt: '2026-11-10', costGroup: 'DRIVER_SHIPMENT',
    feeName: `Phí khai bổ sung ${tag}`, customerChargeAmount: '300000',
  }).returning({ id: s.driverIncidentalCosts.id });
  track(s.driverIncidentalCosts, driverCost.id);
  const [source] = await db.insert(s.expenseAccountingSources).values({
    sourceKind: 'DRIVER', sourceId: driverCost.id, tripId: trip.id, shipmentId: shipment.id,
    status: 'RECORDED', recordedById: admin.id, confirmedById: admin.id, confirmedAt: new Date(),
  }).returning({ id: s.expenseAccountingSources.id });
  track(s.expenseAccountingSources, source.id);
  const [account] = await db.insert(s.treasuryAccounts).values({
    code: `SIL1102RPT-STK-${tag}`, name: `SIL1102 rpt STK ${tag}`, type: 'BANK',
    fundCode: 'COMPANY', status: 'ACTIVE', createdBy: admin.id, updatedBy: admin.id,
  }).returning({ id: s.treasuryAccounts.id });
  track(s.treasuryAccounts, account.id);
  const [movement] = await db.insert(s.treasuryMovements).values({
    treasuryAccountId: account.id, direction: 'IN', amount: '300000', valueDate: '2026-11-10',
    status: 'POSTED', physicalReference: `SIL1102RPT-PT-${tag}`, sourceVersion: 1,
    paymentContractVersion: 2, createdBy: admin.id,
  }).returning({ id: s.treasuryMovements.id });
  track(s.treasuryMovements, movement.id);
  const [voucher] = await db.insert(s.expenseCashVouchers).values({
    code: `SIL1102RPT-PT-${tag}`, counterpartyType: 'CUSTOMER', counterpartyId: customer.id,
    treasuryMovementId: movement.id, createdById: admin.id, note: `SIL1102 rpt phiếu thu ${tag}`,
  }).returning({ id: s.expenseCashVouchers.id });
  track(s.expenseCashVouchers, voucher.id);
  await db.insert(s.expenseCashAllocations).values({
    voucherId: voucher.id, expenseAccountingSourceId: source.id, sourceVersion: 1, amount: '300000',
  });
  return { adminId: admin.id, customerId: customer.id, customerName, tripId: trip.id,
    sourceId: source.id, voucherId: voucher.id, movementId: movement.id, accountId: account.id };
}

const thuRowOf = async (query: { dateFrom: string; dateTo: string }, customerName: string) =>
  (await getPhoiPhieuReport({ kind: 'THU', ...query })).rows.find((row) => row.party === customerName);

describe('SIL-1102 — báo cáo thu thấy phiếu theo NGÀY GIÁ TRỊ, kể cả khoản lái xe khai (BE)', () => {
  const fxPromise = mkDriverLot();
  let fx: Fixture;
  test('phiếu valueDate 10/11 hiện ở chốt 10/11 dù chuyến departure 20/12', async () => {
    fx = await fxPromise;
    const row = await thuRowOf({ dateFrom: '2026-11-01', dateTo: '2026-11-10' }, fx.customerName);
    assert.ok(row, `phải thu của khách phải xuất hiện ở chốt 10/11 (rows: ${(await getPhoiPhieuReport({ kind: 'THU', dateFrom: '2026-11-01', dateTo: '2026-11-10' })).rows.map((r) => r.party).join(', ')})`);
    assert.equal(row.daThuTra, 300000, 'ĐÃ THU tại chốt 10/11 phải thấy trọn 300.000');
    assert.equal(row.phaiThu, 300000);
    assert.equal(row.tienNang + row.tienHa + row.psKhac, 0, 'cửa sổ 10/11 chưa có khoản phí nào của chuyến 20/12');
    assert.equal(row.conLai, -300000, 'khách tạm trả trước so với phí trong cửa sổ — con lại âm (over-pay annotation)');
  });

  test('cửa sổ departure 20/12: khoản lái xe khai vào PHẢI THU (PS khác), đã thu khớp, còn lại 0', async () => {
    const row = await thuRowOf({ dateFrom: '2026-12-20', dateTo: '2026-12-20' }, fx.customerName);
    assert.ok(row, 'chốt 20/12 phải có dòng khách');
    assert.equal(row.psKhac, 300000, 'khoán lái xe khai thu khách là phải thu (không thuộc nâng/hạ)');
    assert.equal(row.tongPhaiThuTra, 300000);
    assert.equal(row.daThuTra, 300000, 'phiếu 10/11 đếm tại chốt 20/12 (valueDate ≤ chốt)');
    assert.equal(row.conLai, 0);
    assert.equal(row.soLuong, 1);
  });

  test('đảo phiếu 26/11: chốt 15/11 vẫn thấy 300.000, chốt 30/11 về 0', async () => {
    await db.update(s.expenseCashVouchers).set({ status: 'REVERSED' }).where(eq(s.expenseCashVouchers.id, fx.voucherId));
    await db.insert(s.treasuryMovements).values({
      treasuryAccountId: fx.accountId, direction: 'OUT', amount: '300000', valueDate: '2026-11-26',
      status: 'POSTED', physicalReference: `SIL1102RPT-PT-REV`, sourceVersion: 2,
      paymentContractVersion: 2, reversalOfId: fx.movementId, createdBy: fx.adminId,
    });
    const at15 = await thuRowOf({ dateFrom: '2026-11-15', dateTo: '2026-11-15' }, fx.customerName);
    assert.ok(at15, 'dòng khách còn tại chốt 15/11');
    assert.equal(at15.daThuTra, 300000, 'đảo SAU chốt không viết lại lịch sử chốt 15/11');
    const at30 = await thuRowOf({ dateFrom: '2026-11-30', dateTo: '2026-11-30' }, fx.customerName);
    assert.ok(!at30 || at30.daThuTra === 0, 'sau khi đảo, chốt 30/11 không còn tiền');
    const at20dec = await thuRowOf({ dateFrom: '2026-12-20', dateTo: '2026-12-20' }, fx.customerName);
    assert.ok(at20dec, 'phải thu của khoản lái xe khai vẫn ở cửa sổ 20/12');
    assert.equal(at20dec.daThuTra, 0);
    assert.equal(at20dec.conLai, 300000, 'đã đảo → còn phải thu đủ 300.000');
  });
});

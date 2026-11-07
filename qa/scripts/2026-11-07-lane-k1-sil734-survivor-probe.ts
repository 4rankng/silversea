/**
 * qa/scripts/2026-11-07-lane-k1-sil734-survivor-probe.ts
 *
 * SIL-734 — probe THẬT trên DB local (integration probe, qa/scripts ownership
 * per AGENTS §2 — BE unit tree stays pure). Runs the REAL engine functions in
 * transactions against the local dev database:
 *
 *   A. Tách cả nhóm REV với pre-merge thật: cả hai lô trở về đúng trạng thái
 *      trước ghép — không kẹt 0₫, không coin biến mất.
 *   B. Tách cả nhóm khi member KHÔNG có pre-merge thật (capture null): lô đi
 *      qua re-price arm (lane miss ở probe này — không có bảng giá) và kết
 *      thúc ở citation 'Chờ tra lại bảng giá' nguyên văn — không bao giờ là
 *      0₫ trần trừi.
 *   C. Xóa Lô chính: survivor kế vị nhận 100% cước thu (3.500.000₫ — đúng
 *      số case Muse từng chụp mất tiền), order=1, nhóm giải tán — tổng tiền
 *      bảo toàn qua bước delete.
 *
 * Run: cd backend && DATABASE_URL=postgres://postgres:postgres@localhost:5441/silversea \
 *      npx tsx ../qa/scripts/2026-11-07-lane-k1-sil734-survivor-probe.ts
 * Evidence: qa/2026-11-07-lane-k1/.
 */
import { eq, inArray } from 'drizzle-orm';

import { db } from '../../backend/src/db';
import * as s from '../../backend/src/db/schema';
import { Role } from '@tingting/shared';
import { mergeLclRevGroup, unmergeLclGroup, promoteLclGroupsOnShipmentDelete } from '../../backend/src/services/lcl-grouping.service';
import { REV_LOT_AWAITING_REPRICE_REASON } from '../../backend/src/services/lcl-rev-notes';
import { disconnectRedis } from '../../backend/src/lib/redis';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const cleanup: Array<{ table: any; id: number; col?: string }> = [];
function track(table: any, id: number, col = 'id') { cleanup.unshift({ table, id, col }); }

async function tripRevenue(tripId: number) {
  const [row] = await db.select().from(s.tripFinancialState).where(eq(s.tripFinancialState.tripId, tripId));
  return row ?? null;
}

async function latestSnapshotTotal(shipmentId: number): Promise<number | null> {
  const rows = await db.select({ totalAmount: s.freightRateSnapshots.totalAmount })
    .from(s.freightRateSnapshots)
    .where(eq(s.freightRateSnapshots.shipmentId, shipmentId))
    .orderBy(s.freightRateSnapshots.id);
  const latest = rows.at(-1);
  return latest ? Number(latest.totalAmount) : null;
}

async function main() {
  const failures: string[] = [];
  const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures.push(label);
  };

  // ── Fixtures ────────────────────────────────────────────────────────────
  const [user] = await db.insert(s.users).values({
    username: `k1probe-${suffix}`, passwordHash: 't', role: Role.ACCOUNTANT, status: 'ACTIVE',
  }).returning({ id: s.users.id });
  track(s.users, user.id);
  const actor = { userId: user.id, username: `k1probe-${suffix}`, fullName: 'K1 probe', role: Role.ACCOUNTANT };
  const [customer] = await db.insert(s.customers).values({ name: `K1 probe KH ${suffix}` }).returning({ id: s.customers.id });
  track(s.customers, customer.id);
  const [route] = await db.insert(s.routes).values({ name: `K1 probe route ${suffix}` }).returning({ id: s.routes.id });
  track(s.routes, route.id);
  const [vehicleClass] = await db.insert(s.vehicleSizeClasses).values({
    code: `K1VC${suffix.slice(0, 6)}`, name: 'K1 probe lớp xe', isContainer: true, sortOrder: 99,
  }).returning({ id: s.vehicleSizeClasses.id });
  track(s.vehicleSizeClasses, vehicleClass.id);

  const lots: Array<{ shipmentId: number; tripId: number }> = [];
  for (const index of [1, 2]) {
    const [shipment] = await db.insert(s.shipments).values({
      customerId: customer.id, routeId: route.id, cargoMode: 'LCL', status: 'DISPATCHED',
      expectedDeliveryDate: '2026-11-06',
    }).returning({ id: s.shipments.id });
    track(s.shipments, shipment.id);
    const [trip] = await db.insert(s.trips).values({
      shipmentId: shipment.id, customerId: customer.id, routeId: route.id,
      tripCode: `TRP-K1-${index}-${suffix}`, departureDate: '2026-11-06', status: 'IN_TRANSIT',
    }).returning({ id: s.trips.id });
    track(s.trips, trip.id);
    // Lô 2 carries its OWN pre-merge cước thu 900.000₫ — the capture has real
    // truth to restore.
    if (index === 2) {
      await db.insert(s.tripFinancialState).values({
        tripId: trip.id, revenue: '900000',
        revenueOverriddenBy: user.id, revenueOverriddenAt: new Date(), revenueOverrideReason: 'K1 probe — cước riêng trước ghép',
      });
    }
    lots.push({ shipmentId: shipment.id, tripId: trip.id });
  }
  const [lot1, lot2] = lots;

  // ── A. Merge → Tách cả nhóm (pre-merge thật) ────────────────────────────
  await mergeLclRevGroup({ shipmentIds: [lot1.shipmentId, lot2.shipmentId], vehicleSizeClassId: vehicleClass.id, freightRevenue: 3_500_000 }, actor);
  const afterMerge1 = await tripRevenue(lot1.tripId);
  const afterMerge2 = await tripRevenue(lot2.tripId);
  check('A0 merge: Lô 1 giữ 100% cước thu nhóm 3.500.000₫', afterMerge1?.revenue === '3500000', `revenue=${afterMerge1?.revenue}`);
  check('A0 merge: Lô 2 về 0₫ + capture thật 900.000₫', afterMerge2?.revenue === '0' && afterMerge2?.revenuePreGroup === '900000' && afterMerge2?.revenuePreGroupCaptured === true,
    `revenue=${afterMerge2?.revenue} pre=${afterMerge2?.revenuePreGroup} captured=${afterMerge2?.revenuePreGroupCaptured}`);

  await unmergeLclGroup({ dimension: 'REV', groupId: (await db.select().from(s.shipments).where(inArray(s.shipments.id, [lot1.shipmentId])))[0]!.revGroupId! }, actor);
  const afterUnmerge1 = await tripRevenue(lot1.tripId);
  const afterUnmerge2 = await tripRevenue(lot2.tripId);
  check('A1 tách cả nhóm: Lô 2 trở về ĐÚNG 900.000₫ (capture)', afterUnmerge2?.revenue === '900000', `revenue=${afterUnmerge2?.revenue}`);
  check('A2 tách cả nhóm: Lô 1 trở về capture trước ghép (NULL = Chưa xác định, không 0₫ giả)',
    afterUnmerge1?.revenue == null && afterUnmerge1?.revenuePreGroupCaptured === false, `revenue=${afterUnmerge1?.revenue}`);
  check('A3 tách cả nhóm: không còn group note trên lô nào',
    (afterUnmerge1?.revenueOverrideReason == null || !afterUnmerge1.revenueOverrideReason.includes('Ghép'))
    && (afterUnmerge2?.revenueOverrideReason == null || !afterUnmerge2.revenueOverrideReason.includes('Ghép')));

  // ── B. Merge lại → member MẤT capture → tách → citation nguyên văn ──────
  await mergeLclRevGroup({ shipmentIds: [lot1.shipmentId, lot2.shipmentId], vehicleSizeClassId: vehicleClass.id, freightRevenue: 3_500_000 }, actor);
  const groupId2 = (await db.select().from(s.shipments).where(eq(s.shipments.id, lot1.shipmentId)))[0]!.revGroupId!;
  // Lô 2 loses its pre-merge truth (the "không có pre-merge thật" case).
  await db.transaction(async (tx) => {
    await tx.update(s.tripFinancialState).set({
      revenuePreGroup: null, revenuePreGroupCaptured: false, revenueOriginal: null,
    }).where(eq(s.tripFinancialState.tripId, lot2.tripId));
  });
  await unmergeLclGroup({ dimension: 'REV', groupId: groupId2 }, actor);
  const afterB2 = await tripRevenue(lot2.tripId);
  check('B1 tách cả nhóm không pre-merge: Lô 2 giữ 0₫ NHƯNG có citation nguyên văn (không 0₫ trần trừi)',
    Number(afterB2?.revenue ?? '0') === 0 && afterB2?.revenueOverrideReason === REV_LOT_AWAITING_REPRICE_REASON,
    `revenue=${afterB2?.revenue} reason=${afterB2?.revenueOverrideReason}`);

  // ── C. Xóa Lô chính → survivor kế vị 100% ────────────────────────────────
  // Production-reachable shape (delete boundary refuses a lot with a live
  // trip): trip-less principal whose 3.500.000₫ rides the shipment-level
  // snapshot grain. The lifecycle order is promote-THEN-flag: the hook runs
  // while the leaver is still a live row, so the crown transfer can see it.
  const tripLessLots: Array<{ shipmentId: number }> = [];
  for (const _ of [1, 2]) {
    const [shipment] = await db.insert(s.shipments).values({
      customerId: customer.id, routeId: route.id, cargoMode: 'LCL', status: 'DISPATCHED',
      expectedDeliveryDate: '2026-11-06',
    }).returning({ id: s.shipments.id });
    track(s.shipments, shipment.id);
    tripLessLots.push({ shipmentId: shipment.id });
  }
  const [lot3, lot4] = tripLessLots;
  await mergeLclRevGroup({ shipmentIds: [lot3.shipmentId, lot4.shipmentId], vehicleSizeClassId: vehicleClass.id, freightRevenue: 3_500_000 }, actor);
  const lot3Snapshot = await latestSnapshotTotal(lot3.shipmentId);
  const lot4Snapshot = await latestSnapshotTotal(lot4.shipmentId);
  check('C0 merge lại (trip-less): tổng cước thu nhóm 3.500.000₫ đứng trên snapshot Lô chính',
    lot3Snapshot === 3_500_000, `total=${lot3Snapshot}`);
  await db.transaction(async (tx) => {
    const leaver = (await tx.select().from(s.shipments).where(eq(s.shipments.id, lot3.shipmentId)).for('update'))[0]!;
    // The lifecycle order: promote first (leaver still a live row), then the
    // soft-delete flag — inside the SAME transaction.
    await promoteLclGroupsOnShipmentDelete(tx, leaver, actor);
    await tx.update(s.shipments).set({ deletedAt: new Date(), version: leaver.version + 1 }).where(eq(s.shipments.id, lot3.shipmentId));
  });
  const survivor4 = await db.select().from(s.shipments).where(eq(s.shipments.id, lot4.shipmentId));
  const survivorSnapshot = await latestSnapshotTotal(lot4.shipmentId);
  const deletedRow = await db.select().from(s.shipments).where(eq(s.shipments.id, lot3.shipmentId));
  check('C1 xóa Lô chính: survivor kế vị nhận 100% cước thu 3.500.000₫ — không mất đồng nào',
    survivorSnapshot === 3_500_000, `total=${survivorSnapshot}`);
  check('C2 xóa Lô chính: nhóm giải tán trên survivor (1 thành viên không là nhóm)',
    survivor4[0]?.revGroupId == null, `revGroupId=${survivor4[0]?.revGroupId}`);
  check('C3 xóa Lô chính: leaver chỉ soft-delete (ghost-guard), dòng live đọc duy nhất là survivor',
    deletedRow[0]?.deletedAt != null && survivor4[0]!.deletedAt == null);

  // ── Cleanup ─────────────────────────────────────────────────────────────
  for (const { table, id, col = 'id' } of cleanup) {
    await db.delete(table).where(eq(table[col], id));
  }
  console.log(failures.length === 0 ? 'PROBE GREEN — mọi assertion PASS' : `PROBE RED — ${failures.length} assertion FAIL`);
  await disconnectRedis().catch(() => {});
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error('PROBE ERROR', error);
  for (const { table, id, col = 'id' } of cleanup) {
    await db.delete(table).where(eq(table[col], id)).catch(() => {});
  }
  process.exit(1);
});

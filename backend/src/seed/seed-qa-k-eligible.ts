/**
 * SIL-894 — QA seed: MỘT driver-day K-eligible trong kỳ 11/2026 cho
 * /timesheet + /timesheet/bao-cao (điểm K của Muse QA đang chặn vì "zero K
 * cells anywhere in the Nov 2026 bao-cao grid").
 *
 * Luật được seed (shared `timesheetSymbolForDay`, SIL-884 5.2 / CR-010):
 *   2 chuyến hoàn thành cùng NGÀY HOÀN THÀNH của cùng lái xe, mang CÙNG số
 *   container (1 Nhập + 1 Xuất chung số cont 40' — cặp Kết hợp) → ô ngày là
 *   K, CHUYẾN 2→1 (K.summaryTrips = 1) và Tổng lệnh kẹp +1 trên bao-cao.
 *
 * Rows tạo ra (đều mang dấu QA — data class `qa-fixture-registry` 'QA%',
 * `qa-fixture-markers` ẩn khỏi /accounting/phoi-phieu):
 *   lô QA-SIL894-K + 2 lệnh (shipment_fulfillments COMBINED) + 2 chuyến
 *   QA-SIL894-K1/K2 (COMPLETED, hoàn thành 2026-11-18) + 2 trip_containers
 *   cùng số cont QATU8940040 + 1 cặp trip_pairs KET_HOP.
 *
 * Ô chấm công KHÔNG bị ghi tay ở đây: script gọi đúng service
 * `syncTimesheetSymbolForTrip` mà engine hoàn thành chuyến gọi, nên ô là gợi ý
 * THẬT của hệ thống (source 'AUTO' → 'Hệ thống tự gợi ý', audit
 * "Tự ghi ký hiệu chấm công K ngày …").
 *
 * Idempotent: trip_code QA-SIL894-K1/K2 là guard. Đã có chuyến ⇒ không tạo
 * thêm row nào; chạy lại chỉ chạy lại sync (repair — ô AUTO mất thì hệ thống
 * ghi lại từ các chuyến COMPLETED còn đó, đúng luật refresh SIL-737; ô MANUAL
 * không bao giờ bị đè).
 *
 * Interlock (cùng luật với seed-qa-fixtures): cần
 * KSEED_ENV=local|staging và từ chối DATABASE_URL trỏ vào prod
 * (silversea.tingting). Fixture là data-class QA — deploy KHÔNG bao giờ dọn
 * (owner rule 26/11: staging data is never wiped); chạy lại script này để QA
 * có lại ô K.
 *
 * Usage (từ backend/):
 *   local:    KSEED_ENV=local npx tsx src/seed/seed-qa-k-eligible.ts
 *   staging:  node dist/seed/seed-qa-k-eligible.js trong backend container
 *             (KSEED_ENV=staging). Khi image chưa chứa script: build rồi
 *             docker cp vào /prod/backend/dist/seed/ — xem mục "Seed
 *             invocation" trong testplan/2026-11-22-sil894-k-eligible-seed-evidence.md.
 */
import { and, eq, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import { syncTimesheetSymbolForTrip } from '../services/timesheet-auto-symbol.service';

export const KSEED_YEAR = 2026;
export const KSEED_MONTH = 11;
/** Thứ Tư, sau các ngày QA đã test D/Q/manual (01–15/11) — một ô K sạch. */
export const KSEED_WORK_DATE = '2026-11-18';
export const KSEED_MONTH_START = '2026-11-01';
export const KSEED_MONTH_END = '2026-11-30';

const TRIP_CODES = ['QA-SIL894-K1', 'QA-SIL894-K2'] as const;
const SHIPMENT_CODE = 'QA-SIL894-K';
/** CÙNG số cont trên cả hai chuyến — chính là input của luật ghép → K. */
const CONTAINER_NUMBER = 'QATU8940040';
/** Naive UTC wall clock (SIL-683): 02:30Z = 09:30 +07 và 08:30Z = 15:30 +07,
 *  cả hai rơi vào ngày kinh doanh VN 2026-11-18. */
const COMPLETED_AT_SQL: readonly SQL[] = [
  sql`'2026-11-18 02:30:00'`,
  sql`'2026-11-18 08:30:00'`,
];

/** Same interlock law as seed-qa-fixtures: explicit grant +
 *  prod-host refusal. QA fixtures never run implicitly and never touch prod. */
export function kSeedEnvBlocked(env: NodeJS.ProcessEnv = process.env): string | null {
  const granted = env.KSEED_ENV;
  if (granted !== 'local' && granted !== 'staging') {
    return `KSEED-REFUSED: KSEED_ENV must be 'local' or 'staging' (got '${granted ?? 'unset'}') — the K-eligible QA seed never runs implicitly.`;
  }
  const url = env.DATABASE_URL ?? '';
  if (/silversea\.tingting/.test(url)) {
    return 'KSEED-REFUSED: DATABASE_URL points at the prod host — QA fixtures never touch prod.';
  }
  return null;
}

async function pickActorUserId(): Promise<number | null> {
  const [dispatcher] = await db.select({ id: s.users.id })
    .from(s.users).where(eq(s.users.role, 'DISPATCHER')).orderBy(s.users.id).limit(1);
  if (dispatcher) return dispatcher.id;
  const [admin] = await db.select({ id: s.users.id })
    .from(s.users).where(eq(s.users.role, 'ADMIN')).orderBy(s.users.id).limit(1);
  return admin?.id ?? null;
}

/** Existing staging data first (task: dùng data có sẵn); tạo mới chỉ khi thiếu
 *  và luôn mang dấu 'QA' trong tên. Ứng viên = lái xe nội bộ còn hoạt động,
 *  có xe gán, CHƯA có kỳ 11/2026 và CHƯA có chuyến hoàn thành trong tháng
 *  (ô K seed ra không đụng dữ liệu QA đã test D/Q/manual). */
async function pickDriver(): Promise<{ id: number; name: string; truckId: number; created: boolean }> {
  const candidates = await db.select({
    id: s.drivers.id, name: s.drivers.name, truckId: s.drivers.assignedTruckId,
  })
    .from(s.drivers)
    .where(and(
      isNull(s.drivers.deletedAt),
      eq(s.drivers.status, 'ACTIVE'),
      isNotNull(s.drivers.assignedTruckId),
      sql`not exists (select 1 from driver_timesheet_months m where m.driver_id = ${s.drivers.id} and m.year = ${KSEED_YEAR} and m.month = ${KSEED_MONTH})`,
      sql`not exists (select 1 from trips t where t.driver_id = ${s.drivers.id} and t.deleted_at is null and t.completed_at is not null and (t.completed_at at time zone 'UTC' at time zone 'Asia/Ho_Chi_Minh')::date between ${KSEED_MONTH_START} and ${KSEED_MONTH_END})`,
    ))
    .orderBy(s.drivers.id)
    .limit(1);
  const eligible = candidates[0];
  if (eligible && eligible.truckId != null) {
    return { id: eligible.id, name: eligible.name, truckId: eligible.truckId, created: false };
  }

  const [truck] = await db.select({ id: s.trucks.id })
    .from(s.trucks)
    .where(and(isNull(s.trucks.carrierId), isNull(s.trucks.deletedAt), eq(s.trucks.status, 'ACTIVE')))
    .orderBy(s.trucks.id).limit(1);
  if (!truck) throw new Error('KSEED-FAILED: không có xe nội bộ nào để gán chuyến.');
  const [created] = await db.insert(s.drivers).values({
    name: 'QA Ghép Cont40 SIL-894',
    code: 'QASIL894',
    salaryMode: 'PER_TRIP',
    status: 'ACTIVE',
    assignedTruckId: truck.id,
  }).returning({ id: s.drivers.id, name: s.drivers.name });
  return { id: created!.id, name: created!.name, truckId: truck.id, created: true };
}

async function pickCustomerId(): Promise<number> {
  // Dùng KH mang dấu QA nếu có (fixture QAKH-DEMO…): KH thật có tài khoản CUS
  // và lô QA không nên xuất hiện trong portal của họ.
  const [qa] = await db.select({ id: s.customers.id })
    .from(s.customers)
    .where(and(
      isNull(s.customers.deletedAt),
      sql`(${s.customers.code} ILIKE 'QA%' OR ${s.customers.name} ILIKE 'QA%')`,
    ))
    .orderBy(s.customers.id).limit(1);
  if (qa) return qa.id;
  const [created] = await db.insert(s.customers).values({
    name: 'QA KH SIL-894',
    shortName: 'QASIL894',
    code: 'QASIL894KH',
    status: 'ACTIVE',
  }).returning({ id: s.customers.id });
  return created!.id;
}

async function pickRouteId(): Promise<number> {
  const [route] = await db.select({ id: s.routes.id }).from(s.routes).orderBy(s.routes.id).limit(1);
  if (!route) throw new Error('KSEED-FAILED: không có routes nào trên DB.');
  return route.id;
}

/** Bằng chứng seed — in đúng các query verify mà QA dùng đối chiếu. */
async function printVerification(driverId: number): Promise<void> {
  const shape = await db.execute(sql`
    SELECT t.id, t.trip_code, t.status, t.completed_at,
           (t.completed_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS business_date,
           tc.container_number, tp.pair_kind
    FROM trips t
    LEFT JOIN trip_containers tc ON tc.trip_id = t.id
    LEFT JOIN trip_pairs tp ON tp.id = t.active_trip_pair_id
    WHERE t.trip_code IN ('QA-SIL894-K1', 'QA-SIL894-K2')
    ORDER BY t.id`);
  console.log('KSEED-VERIFY trips (input shape):');
  for (const row of shape as unknown as Array<Record<string, unknown>>) console.log(' ', JSON.stringify(row));

  const cell = await db.execute(sql`
    SELECT d.id AS driver_id, d.name AS driver, dd.work_date, dd.symbol, dd.source,
           dd.entered_by, dd.entered_at, m.status AS month_status
    FROM driver_timesheet_days dd
    JOIN drivers d ON d.id = dd.driver_id
    JOIN driver_timesheet_months m ON m.id = dd.month_id
    WHERE dd.driver_id = ${driverId} AND dd.work_date = ${KSEED_WORK_DATE}`);
  console.log('KSEED-VERIFY driver-day (source AUTO = "Hệ thống tự gợi ý"):');
  for (const row of cell as unknown as Array<Record<string, unknown>>) console.log(' ', JSON.stringify(row));

  // Đúng phép đếm của bao-cao (TimesheetMonthlyReportPage): donCells/kepCells
  // đếm NGÀY mang ký hiệu, quayDau = 2 chuyến/ngày Q, total = Đ + K + 2·Q.
  const baoCao = await db.execute(sql`
    SELECT d.id AS driver_id, d.name AS driver,
           count(*) FILTER (WHERE dd.symbol = 'Đ') AS tong_lenh_don,
           count(*) FILTER (WHERE dd.symbol = 'K') AS tong_lenh_kep,
           count(*) FILTER (WHERE dd.symbol = 'Q') * 2 AS so_chuyen_quay_dau,
           count(*) FILTER (WHERE dd.symbol = 'Đ')
             + count(*) FILTER (WHERE dd.symbol = 'K')
             + count(*) FILTER (WHERE dd.symbol = 'Q') * 2 AS tong_so_chuyen
    FROM driver_timesheet_days dd
    JOIN drivers d ON d.id = dd.driver_id
    JOIN driver_timesheet_months m ON m.id = dd.month_id
    WHERE m.year = ${KSEED_YEAR} AND m.month = ${KSEED_MONTH} AND d.id = ${driverId}
    GROUP BY d.id, d.name`);
  console.log('KSEED-VERIFY bao-cao row 11/2026 (Tổng lệnh kẹp ≥ 1, CHUYẾN 2→1):');
  for (const row of baoCao as unknown as Array<Record<string, unknown>>) console.log(' ', JSON.stringify(row));

  const audit = await db.execute(sql`
    SELECT user_id, message, entity_type, entity_id
    FROM audit_logs
    WHERE message = 'Tự ghi ký hiệu chấm công K ngày ${sql.raw(KSEED_WORK_DATE)}'
    ORDER BY id`);
  console.log('KSEED-VERIFY audit (system auto-write):');
  for (const row of audit as unknown as Array<Record<string, unknown>>) console.log(' ', JSON.stringify(row));
}

async function main(): Promise<void> {
  const blocked = kSeedEnvBlocked();
  if (blocked) {
    console.error(blocked);
    process.exitCode = 1;
    return;
  }

  const actorUserId = await pickActorUserId();

  // ── Guard: đã seed thì không tạo thêm row nào — chỉ chạy lại sync ──
  const existing = await db.select({ id: s.trips.id, tripCode: s.trips.tripCode, driverId: s.trips.driverId })
    .from(s.trips).where(inArray(s.trips.tripCode, [...TRIP_CODES])).orderBy(s.trips.id);
  if (existing.length > 0) {
    const first = existing[0]!;
    const result = await syncTimesheetSymbolForTrip(first.id, actorUserId);
    console.log(`KSEED-SKIP đã seed trước đó (${existing.map((t) => `${t.tripCode}#${t.id}`).join(', ')}) — chỉ chạy lại system sync: reason=${result.reason} symbol=${result.symbol} workDate=${result.workDate}`);
    await printVerification(first.driverId!);
    return;
  }

  const driver = await pickDriver();
  const customerId = await pickCustomerId();
  const routeId = await pickRouteId();
  console.log(`KSEED-TARGET driver=${driver.name}(id=${driver.id}${driver.created ? ', QA-created' : ''}) truck=${driver.truckId} customer=${customerId} route=${routeId} day=${KSEED_WORK_DATE} cont=${CONTAINER_NUMBER}`);

  // ── Seed + gợi ý K: MỘT transaction, service của hệ thống ghi ô ──
  const seeded = await db.transaction(async (tx) => {
    const [shipment] = await tx.insert(s.shipments).values({
      shipmentCode: SHIPMENT_CODE,
      customerId,
      routeId,
      status: 'COMPLETED',
      cargoMode: 'FCL',
      expectedDeliveryDate: KSEED_WORK_DATE,
      operationalNotes: 'QA SIL-894 seed điểm K: cặp Kết hợp 2 lệnh chung cont 40 — dữ liệu QA (data class qa-fixture-registry).',
    }).returning({ id: s.shipments.id });
    const shipmentId = shipment!.id;

    const fulfillmentIds: number[] = [];
    for (let i = 0; i < 2; i += 1) {
      const [fulfillment] = await tx.insert(s.shipmentFulfillments).values({
        shipmentId,
        fulfillmentType: 'FCL_CONTAINER',
        cargoMode: 'FCL',
        sourceShipmentVersion: 1,
        dispatchClassification: 'COMBINED',
        createdBy: actorUserId,
      }).returning({ id: s.shipmentFulfillments.id });
      fulfillmentIds.push(fulfillment!.id);
    }

    const tripIds: number[] = [];
    for (let i = 0; i < 2; i += 1) {
      const [trip] = await tx.insert(s.trips).values({
        tripCode: TRIP_CODES[i]!,
        customerId,
        routeId,
        departureDate: KSEED_WORK_DATE,
        truckId: driver.truckId,
        driverId: driver.id,
        shipmentId,
        fulfillmentId: fulfillmentIds[i]!,
        containerCount: 1,
        status: 'COMPLETED',
        completedAt: COMPLETED_AT_SQL[i]! as unknown as Date,
        createdBy: actorUserId,
        notes: 'QA SIL-894 seed điểm K (chuyến ghép chung cont 40).',
      }).returning({ id: s.trips.id });
      tripIds.push(trip!.id);
    }

    const [pair] = await tx.insert(s.tripPairs).values({
      status: 'ACTIVE',
      pairKind: 'KET_HOP',
      firstTripId: tripIds[0]!,
      secondTripId: tripIds[1]!,
      createdBy: actorUserId,
    }).returning({ id: s.tripPairs.id });
    await tx.update(s.trips).set({ activeTripPairId: pair!.id, activeTripPairOrder: 1 }).where(eq(s.trips.id, tripIds[0]!));
    await tx.update(s.trips).set({ activeTripPairId: pair!.id, activeTripPairOrder: 2 }).where(eq(s.trips.id, tripIds[1]!));

    for (const tripId of tripIds) {
      await tx.insert(s.tripContainers).values({
        tripId,
        containerNumber: CONTAINER_NUMBER,
        createdBy: actorUserId,
      });
    }

    // Gợi ý K đến từ service của hệ thống (cùng code engine hoàn thành chuyến
    // gọi) — không có ô nào được ghi tay ở đây.
    const sync = [];
    for (const tripId of tripIds) {
      const result = await syncTimesheetSymbolForTrip(tripId, actorUserId, tx);
      if (result.reason !== 'WRITTEN') {
        throw new Error(`KSEED-FAILED: system sync từ chối ghi ô (${result.reason}) — rollback, không để dữ liệu mồ côi.`);
      }
      sync.push(result);
    }
    return { shipmentId, fulfillmentIds, tripIds, pairId: pair!.id, sync };
  });

  console.log(`KSEED-SEED shipment=${SHIPMENT_CODE}(${seeded.shipmentId}) fulfillments=${seeded.fulfillmentIds.join(',')} trips=${seeded.tripIds.join(',')} pair=${seeded.pairId}`);
  for (const result of seeded.sync) {
    console.log(`KSEED-SYNC ${result.reason} symbol=${result.symbol} workDate=${result.workDate} wrote=${result.wrote}`);
  }
  await printVerification(driver.id);
}

// Run directly (KSEED_ENV=… npx tsx src/seed/seed-qa-k-eligible.ts); importable for tests.
if (process.argv[1]?.includes('seed-qa-k-eligible')) {
  void main();
}

// SIL-1053 (r28d) — the completion/progress gate law for the driver app.
//
// 1. On the driver's self-recorded flow ("nhận lệnh đã ghi" — ORDER_RECEIVED
//    recorded via the K2.42 strip), completion requires ALL FOUR milestones of
//    DRIVER_FULFILLMENT_PROGRESS_SEQUENCE: a missing stage 409s with what is
//    missing and the trip stays IN_TRANSIT (no synthetic stages).
// 2. With all four recorded, completion succeeds and closes the trip.
// 3. A closed trip records no further milestones — the refusal names the
//    closed trip (409) and fires before any sequence verdict can mask it.
// 4. The SIL-817 lane is preserved: a dispatch-started RUNNING trip with no
//    recorded ORDER_RECEIVED still completes through inference.
//
// Harness: throwaway schema-only DB (the shipment-children-fk pattern) with
// the REAL service functions — same shape as invoice-tracking-idempotency-key.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import postgres from 'postgres';
import type { Sql } from 'postgres';
import { DriverProgressEventType, TripStatus } from '@tingting/shared';
// Type-only namespace for the dynamically bound service module below.
import type * as DriverFulfillmentService from '../services/driver-fulfillment.service';

const TMP_DB = `sil1053_milestone_gate_${Date.now().toString(36)}`;
const TMP_URL = 'postgres://postgres:postgres@localhost:5441/' + TMP_DB;
// Must precede every dynamic import of db-touching modules: db/config reads
// this at module init (shipment-children-fk pattern).
process.env.DATABASE_URL = TMP_URL;

let sql: Sql;
let service: typeof DriverFulfillmentService;
let driverId: number;
let actorId: number;
let selfFulfillmentId: number;
let selfTripId: number;
let dispatchFulfillmentId: number;
let dispatchTripId: number;

async function recordMilestone(tripId: number, eventType: DriverProgressEventType): Promise<void> {
  await sql`insert into driver_progress_events (trip_id, driver_id, event_type, occurred_at, recorded_by)
    values (${tripId}, ${driverId}, ${eventType}, now(), ${actorId})`;
}

before(async () => {
  const admin = postgres('postgres://postgres:postgres@localhost:5441/postgres');
  await admin.unsafe(`CREATE DATABASE ${TMP_DB}`);
  await admin.end();
  const dump = execFileSync(
    'docker',
    ['exec', 'ss-prod-db', 'pg_dump', '-U', 'postgres', '-d', 'silversea', '--schema-only'],
    { encoding: 'utf8', timeout: 120000 },
  );
  const dumpSql = dump.split('\n').filter((line) => !line.startsWith('\\')).join('\n');
  const restore = postgres(TMP_URL);
  await restore.unsafe(dumpSql);
  await restore.end();
  sql = postgres(TMP_URL);

  [actorId] = await sql`insert into users (username, email, full_name, password_hash, role)
    values ('lx-1053', 'lx-1053@test.vn', 'Lái Xe 1053', 'x', 'DRIVER') returning id`
    .then((rows) => (rows as unknown as Array<{ id: number }>).map((row) => row.id));
  [driverId] = await sql`insert into drivers (name, user_id) values ('Tài xế SIL-1053', ${actorId}) returning id`
    .then((rows) => (rows as unknown as Array<{ id: number }>).map((row) => row.id));
  const [customer] = await sql`insert into customers (name) values ('Khách SIL-1053') returning id`;
  const [route] = await sql`insert into routes (name) values ('Tuyến SIL-1053') returning id`;

  // Two independent shipments/fulfillments/trips: the self-recorded flow
  // under test, and the dispatch-started lane that must keep inferring.
  const [shipmentSelf] = await sql`
    insert into shipments (customer_id, cargo_mode, shipment_code, status, created_by)
    values (${customer.id}, 'FCL', 'SIL1053-SELF', 'DISPATCHED', ${actorId}) returning id`;
  const [fulfillmentSelf] = await sql`
    insert into shipment_fulfillments (shipment_id, fulfillment_type, cargo_mode, source_shipment_version)
    values (${shipmentSelf.id}, 'FCL_CONTAINER', 'FCL', 1) returning id`;
  [selfTripId] = await sql`
    insert into trips (trip_code, customer_id, route_id, departure_date, status, driver_id, shipment_id, fulfillment_id)
    values ('TRP-1053-SELF', ${customer.id}, ${route.id}, current_date, 'IN_TRANSIT', ${driverId}, ${shipmentSelf.id}, ${fulfillmentSelf.id})
    returning id`.then((rows) => (rows as unknown as Array<{ id: number }>).map((row) => row.id));
  selfFulfillmentId = fulfillmentSelf.id;

  const [shipmentDispatch] = await sql`
    insert into shipments (customer_id, cargo_mode, shipment_code, status, created_by)
    values (${customer.id}, 'FCL', 'SIL1053-DISP', 'DISPATCHED', ${actorId}) returning id`;
  const [fulfillmentDispatch] = await sql`
    insert into shipment_fulfillments (shipment_id, fulfillment_type, cargo_mode, source_shipment_version)
    values (${shipmentDispatch.id}, 'FCL_CONTAINER', 'FCL', 1) returning id`;
  [dispatchTripId] = await sql`
    insert into trips (trip_code, customer_id, route_id, departure_date, status, driver_id, shipment_id, fulfillment_id)
    values ('TRP-1053-DISP', ${customer.id}, ${route.id}, current_date, 'IN_TRANSIT', ${driverId}, ${shipmentDispatch.id}, ${fulfillmentDispatch.id})
    returning id`.then((rows) => (rows as unknown as Array<{ id: number }>).map((row) => row.id));
  dispatchFulfillmentId = fulfillmentDispatch.id;

  // Self-flow: the driver recorded the acceptance and the first pickup stage.
  await recordMilestone(selfTripId, DriverProgressEventType.ORDER_RECEIVED);
  await recordMilestone(selfTripId, DriverProgressEventType.PICKED_UP);

  // Dynamic import REQUIRED (shipment-children-fk pattern): the service
  // transitively imports db, whose drizzle client binds DATABASE_URL at module
  // init — a static import would bind the DEV database before this hook points
  // the env at the throwaway one above.
  service = await import('../services/driver-fulfillment.service');
});

after(async () => {
  if (sql) await sql.end();
  // The service's drizzle pool still holds connections to the throwaway DB —
  // same dynamic-import reason as above. Close it, then FORCE-drop.
  const { client } = await import('../db');
  await client.end({ timeout: 5 });
  const admin = postgres('postgres://postgres:postgres@localhost:5441/postgres');
  await admin.unsafe(`DROP DATABASE IF EXISTS ${TMP_DB} WITH (FORCE)`);
  await admin.end();
});

describe('SIL-1053 — completion gate + closed-trip progress guard', () => {
  test('hoàn tất thiếu mốc trên luồng lái xe tự ghi → 409 nêu mốc còn thiếu, chuyến chưa đóng', async () => {
    await assert.rejects(
      () => service.completeOwnedFulfillmentTrip({
        fulfillmentId: selfFulfillmentId,
        driverId,
        actorUserId: actorId,
        expectedVersion: 1,
        idempotencyKey: 'sil1053-self-missing',
        invalidateReports: async () => {},
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Còn thiếu/);
        assert.match(error.message, /Đang đóng \/ Trả hàng/);
        assert.match(error.message, /Đã hạ bãi \/ Giao hàng/);
        return true;
      },
    );
    const [trip] = await sql`select status from trips where id = ${selfTripId}`;
    assert.equal(trip.status, TripStatus.IN_TRANSIT, 'a refused completion never closes the trip');
    const events = await sql`select id from driver_progress_events where trip_id = ${selfTripId}`;
    assert.equal(events.length, 2, 'a refused completion synthesizes no milestones');
  });

  test('đủ 4 mốc → hoàn tất OK, chuyến COMPLETED', async () => {
    await recordMilestone(selfTripId, DriverProgressEventType.LOADING_OR_RETURNING);
    await recordMilestone(selfTripId, DriverProgressEventType.DELIVERED);
    const { trip } = await service.completeOwnedFulfillmentTrip({
      fulfillmentId: selfFulfillmentId,
      driverId,
      actorUserId: actorId,
      expectedVersion: 1,
      idempotencyKey: 'sil1053-self-full',
      invalidateReports: async () => {},
    });
    assert.equal(trip.status, TripStatus.COMPLETED);
    const [row] = await sql`select status, completed_at from trips where id = ${selfTripId}`;
    assert.equal(row.status, TripStatus.COMPLETED);
    assert.ok(row.completed_at, 'the close records its completion timestamp');
    const events = await sql`select id from driver_progress_events where trip_id = ${selfTripId}`;
    assert.equal(events.length, 4, 'exactly the four recorded stages — no synthetic extras');
  });

  test('progress trên chuyến đã đóng → 409 thông điệp rõ', async () => {
    await assert.rejects(
      () => service.recordDriverFulfillmentProgress({
        fulfillmentId: selfFulfillmentId,
        driverId,
        input: {
          eventType: DriverProgressEventType.PICKED_UP,
          occurredAt: new Date().toISOString(),
        },
        recordedBy: actorId,
        idempotencyKey: 'sil1053-closed-progress',
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Chuyến đã hoàn thành — không thể ghi mốc tiến độ/);
        return true;
      },
    );
    const events = await sql`select id from driver_progress_events where trip_id = ${selfTripId}`;
    assert.equal(events.length, 4, 'a refused progress write records nothing');
  });

  test('giữ nguyên luồng hoàn tất suy-ra cho chuyến điều phối khởi động (SIL-817)', async () => {
    // Dispatch-started strand: RUNNING trip, ORDER_RECEIVED never recorded —
    // completion still infers the acceptance and every post-accept stage.
    const { trip } = await service.completeOwnedFulfillmentTrip({
      fulfillmentId: dispatchFulfillmentId,
      driverId,
      actorUserId: actorId,
      expectedVersion: 1,
      idempotencyKey: 'sil1053-dispatch-infer',
      invalidateReports: async () => {},
    });
    assert.equal(trip.status, TripStatus.COMPLETED, 'the SIL-817 escape hatch never strands a running trip');
    const events = await sql`select event_type from driver_progress_events where trip_id = ${dispatchTripId} order by id`;
    assert.equal(events.length, 4, 'the inference lane records all four stages on completion');
  });
});

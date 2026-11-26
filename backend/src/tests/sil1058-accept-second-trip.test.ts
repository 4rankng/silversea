// SIL-1058 (CR-011.1 BUG-03) — accepting a SECOND trip is never blocked.
//
// CR-011 removed the 1 xe = 1 chuyến hard block: another running trip is a
// SOFT notice in the driver app, and the accept milestone (ORDER_RECEIVED)
// must succeed for the second trip — no 400/409 — for both Hàng Cont (FCL)
// and Hàng Lẻ (LCL). The machine-level bypass is
// trip-status-machine.service.ts: `driverOwnedFulfillmentStart != null` →
// busyTrips scan skipped → busyTruck undefined → no DRIVER_TRIP_BLOCKED 409.
// This test pins the end-to-end behavior through the REAL entry point the
// API route uses (recordDriverProgress → recordDriverFulfillmentProgress →
// transitionTripStatus CREATED→IN_TRANSIT).
//
// Harness: throwaway schema-only DB (the sil1053-milestone-completion-gate
// pattern) with the REAL service functions.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import postgres from 'postgres';
import type { Sql } from 'postgres';
import { DriverProgressEventType, TripStatus } from '@tingting/shared';
// Type-only namespace for the dynamically bound service module below.
import type * as DriverService from '../services/driver.service';

const TMP_DB = `sil1058_accept_second_${Date.now().toString(36)}`;
const TMP_URL = 'postgres://postgres:postgres@localhost:5441/' + TMP_DB;
// Must precede every dynamic import of db-touching modules: db/config reads
// this at module init (shipment-children-fk pattern).
process.env.DATABASE_URL = TMP_URL;

let sql: Sql;
let service: typeof DriverService;
let driverId: number;
let actorId: number;
let runningTripId: number;
let contTripId: number;
let lclTripId: number;

async function insertLeg(args: {
  code: string;
  cargoMode: 'FCL' | 'LCL';
  fulfillmentType: 'FCL_CONTAINER' | 'LCL_SHIPMENT';
  status: 'CREATED' | 'IN_TRANSIT';
  customerId: number;
  routeId: number;
}): Promise<{ tripId: number; fulfillmentId: number }> {
  const [shipment] = await sql`
    insert into shipments (customer_id, cargo_mode, shipment_code, status, created_by)
    values (${args.customerId}, ${args.cargoMode}, ${'SIL1058-' + args.code}, 'DISPATCHED', ${actorId}) returning id`;
  // shipment_fulfillments_lcl_dispatch_classification_check: an LCL
  // fulfillment must carry the LCL dispatch classification.
  const [fulfillment] = await sql`
    insert into shipment_fulfillments (shipment_id, fulfillment_type, cargo_mode, source_shipment_version, dispatch_classification)
    values (${shipment.id}, ${args.fulfillmentType}, ${args.cargoMode}, 1, ${args.cargoMode === 'LCL' ? 'LCL' : 'SINGLE'}) returning id`;
  const rows = await sql`
    insert into trips (trip_code, customer_id, route_id, departure_date, status, driver_id, shipment_id, fulfillment_id)
    values (${'TRP-1058-' + args.code}, ${args.customerId}, ${args.routeId}, current_date, ${args.status}, ${driverId}, ${shipment.id}, ${fulfillment.id})
    returning id`;
  return { tripId: (rows as unknown as Array<{ id: number }>)[0].id, fulfillmentId: fulfillment.id };
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
    values ('lx-1058', 'lx-1058@test.vn', 'Lái Xe 1058', 'x', 'DRIVER') returning id`
    .then((rows) => (rows as unknown as Array<{ id: number }>).map((row) => row.id));
  [driverId] = await sql`insert into drivers (name, user_id) values ('Tài xế SIL-1058', ${actorId}) returning id`
    .then((rows) => (rows as unknown as Array<{ id: number }>).map((row) => row.id));
  const [customer] = await sql`insert into customers (name) values ('Khách SIL-1058') returning id`;
  const [route] = await sql`insert into routes (name) values ('Tuyến SIL-1058') returning id`;

  // The ticket's stage: chuyến 1 already running on the driver (Tab Đã nhận),
  // lệnh 2 arrives fresh (Tab Lệnh mới) — once as Hàng Cont, once as Hàng Lẻ.
  const running = await insertLeg({ code: 'RUN-FCL', cargoMode: 'FCL', fulfillmentType: 'FCL_CONTAINER', status: 'IN_TRANSIT', customerId: customer.id, routeId: route.id });
  runningTripId = running.tripId;
  await sql`insert into driver_progress_events (trip_id, driver_id, event_type, occurred_at, recorded_by)
    values (${runningTripId}, ${driverId}, 'ORDER_RECEIVED', now(), ${actorId})`;
  const cont = await insertLeg({ code: 'NEW-FCL', cargoMode: 'FCL', fulfillmentType: 'FCL_CONTAINER', status: 'CREATED', customerId: customer.id, routeId: route.id });
  contTripId = cont.tripId;
  const lcl = await insertLeg({ code: 'NEW-LCL', cargoMode: 'LCL', fulfillmentType: 'LCL_SHIPMENT', status: 'CREATED', customerId: customer.id, routeId: route.id });
  lclTripId = lcl.tripId;

  // Dynamic import REQUIRED (shipment-children-fk pattern): the service
  // transitively imports db, whose drizzle client binds DATABASE_URL at module
  // init — a static import would bind the DEV database before this hook points
  // the env at the throwaway one above.
  service = await import('../services/driver.service');
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

describe('SIL-1058 — accept-trip lệnh thứ 2 với 1 chuyến đang chạy (CR-011.1)', () => {
  test('Hàng Cont: accept ORDER_RECEIVED trên lệnh 2 → thành công (không 400/409), CREATED → IN_TRANSIT', async () => {
    const { event } = await service.recordDriverProgress(
      contTripId,
      driverId,
      { eventType: DriverProgressEventType.ORDER_RECEIVED, occurredAt: new Date().toISOString() },
      actorId,
      'sil1058-cont-accept',
    );
    assert.equal(event.eventType, DriverProgressEventType.ORDER_RECEIVED, 'the accept milestone is recorded, not refused');
    const [trip] = await sql`select status, version from trips where id = ${contTripId}`;
    assert.equal(trip.status, TripStatus.IN_TRANSIT, 'the accept starts the second trip');
    // The route maps first-record to 201 and replay to 200 — both success;
    // the law under test is that NO 400/409 fires.
  });

  test('Hàng Lẻ: accept ORDER_RECEIVED trên lệnh 2 → thành công (không 400/409), CREATED → IN_TRANSIT', async () => {
    const { event } = await service.recordDriverProgress(
      lclTripId,
      driverId,
      { eventType: DriverProgressEventType.ORDER_RECEIVED, occurredAt: new Date().toISOString() },
      actorId,
      'sil1058-lcl-accept',
    );
    assert.equal(event.eventType, DriverProgressEventType.ORDER_RECEIVED, 'the accept milestone is recorded, not refused');
    const [trip] = await sql`select status from trips where id = ${lclTripId}`;
    assert.equal(trip.status, TripStatus.IN_TRANSIT, 'the accept starts the second trip');
  });

  test('2 chuyến song song: chuyến 1 vẫn IN_TRANSIT, không bị chạm vào', async () => {
    const [running] = await sql`select status from trips where id = ${runningTripId}`;
    assert.equal(running.status, TripStatus.IN_TRANSIT, 'the first running trip is untouched');
    const events = await sql`select id from driver_progress_events where trip_id = ${runningTripId}`;
    assert.equal(events.length, 1, 'no cross-trip milestone contamination');
    const both = await sql`select id from trips where driver_id = ${driverId} and status = 'IN_TRANSIT'`;
    assert.equal(both.length, 3, 'the driver runs every accepted trip in parallel — chuyến 1 + lệnh Cont + lệnh Lẻ');
  });
});

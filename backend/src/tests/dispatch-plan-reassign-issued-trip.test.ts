// SIL-1236 (KB §2.3.5 Ranh giới sửa phân công) — PATCH
// /api/shipments/dispatch-detail-plan-rows/:id/plan on an ISSUED row is no
// longer a blanket 409:
//   * trip not yet accepted (no ORDER_RECEIVED) → the save passes AND the
//     live trip row syncs the new truck/driver/trailer (the phát-lệnh trip
//     reflects the plan, not just the fulfillment snapshot);
//   * trip accepted → vehicle-only: an EXTERNAL plate change passes and
//     syncs; a driver-dimension change 409s with the reason + allowed path;
//   * terminal states keep today's refusals (lot COMPLETED → lot message;
//     trip COMPLETED → the issued-order message); unassign on a live trip
//     points at Hủy phân xe.
// Harness: throwaway schema-only DB behind the REAL dispatch-planning router
// with a stub auth layer (lcl-cost-group-add-members pattern).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import express from 'express';
import type { Server } from 'node:http';
import postgres from 'postgres';
import { ApiError } from '../errors';
import { Role } from '@tingting/shared';

const TMP_DB = `plan_reassign_test_${Date.now().toString(36)}`;
const TMP_URL = 'postgres://postgres:postgres@localhost:5441/' + TMP_DB;
process.env.DATABASE_URL = TMP_URL;

let sql: postgres.Sql;
let server: Server;
let baseUrl: string;
let customerAId: number;
let routeId: number;
let truckAId: number;
let truckBId: number;
let trailerAId: number;
let trailerBId: number;
let driverD1Id: number;
let driverD2Id: number;
let externalCarrierId: number;
// tractor with NO roster assignment and NO coupling — the driverless wall
let truckCDriverlessId: number;
// lot S1: issued OWN trip, CREATED, not accepted
let ff1Id: number;
let trip1Id: number;
// lot S2: issued EXTERNAL trip, IN_TRANSIT, driver accepted
let ff2Id: number;
let trip2Id: number;
// lot S3: COMPLETED lot (terminal lot status must still 409 with the lot message)
let ff3Id: number;
// lot S4: DISPATCHED lot whose trip is COMPLETED (terminal trip → issued-order message)
let ff4Id: number;
// lot S5: issued OWN trip, IN_TRANSIT, driver accepted (vehicle-only law, OWN side)
let ff5Id: number;
let trip5Id: number;
// lot S6: issued OWN trip, CREATED, not accepted — driverless-tractor wall
let ff6Id: number;

let idemSeq = 0;
function patchPlan(fulfillmentId: number, body: Record<string, unknown>, expectedVersions: { fulfillment: number; shipment: number }) {
  idemSeq += 1;
  return fetch(`${baseUrl}/api/shipments/dispatch-detail-plan-rows/${fulfillmentId}/plan`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': `sil1236-${idemSeq}` },
    body: JSON.stringify({
      expectedFulfillmentVersion: expectedVersions.fulfillment,
      expectedShipmentVersion: expectedVersions.shipment,
      plannedRevenue: null,
      plannedCarrierCost: null,
      ...body,
    }),
  });
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

  const [customer] = await sql`insert into customers (name, status) values ('Khách SIL-1236', 'ACTIVE') returning id`;
  customerAId = customer.id;
  const [carrier] = await sql`insert into customers (name, status, is_carrier) values ('Nhà thầu SIL-1236', 'ACTIVE', true) returning id`;
  externalCarrierId = carrier.id;
  const [route] = await sql`insert into routes (name) values ('Tuyến SIL-1236') returning id`;
  routeId = route.id;

  const [trailerA] = await sql`insert into trailers (license_plate) values ('15R-1236A') returning id`;
  trailerAId = trailerA.id;
  const [trailerB] = await sql`insert into trailers (license_plate) values ('15R-1236B') returning id`;
  trailerBId = trailerB.id;
  const [truckA] = await sql`insert into trucks (license_plate, current_trailer_id, status) values ('29A-123.01', ${trailerA.id}, 'ACTIVE') returning id`;
  truckAId = truckA.id;
  const [truckB] = await sql`insert into trucks (license_plate, current_trailer_id, status) values ('29B-456.02', ${trailerB.id}, 'ACTIVE') returning id`;
  truckBId = truckB.id;
  const [truckC] = await sql`insert into trucks (license_plate, status) values ('29C-789.03', 'ACTIVE') returning id`;
  truckCDriverlessId = truckC.id;
  const [driverD1] = await sql`insert into drivers (name, status) values ('Tài Xế Một', 'ACTIVE') returning id`;
  driverD1Id = driverD1.id;
  const [driverD2] = await sql`insert into drivers (name, status) values ('Tài Xế Hai', 'ACTIVE') returning id`;
  driverD2Id = driverD2.id;
  // 1:1 active PRIMARY pairings (the plan save resolves the driver from the
  // tractor's roster assignment, exactly like the issue flow).
  await sql`insert into truck_driver_assignments (truck_id, driver_id) values (${truckA.id}, ${driverD1.id})`;
  await sql`insert into truck_driver_assignments (truck_id, driver_id) values (${truckB.id}, ${driverD2.id})`;

  const lot = async (code: string, status: string) => {
    const [lotRow] = await sql`
      insert into shipments (customer_id, cargo_mode, shipment_code, status)
      values (${customer.id}, 'LCL', ${code}, ${status})
      returning id`;
    const [ff] = await sql`
      insert into shipment_fulfillments (shipment_id, fulfillment_type, cargo_mode, dispatch_classification, source_shipment_version)
      values (${lotRow.id}, 'LCL_SHIPMENT', 'LCL', 'LCL', 1)
      returning id`;
    return { lotId: lotRow.id, ffId: ff.id };
  };

  // S1 — issued OWN, CREATED, no ORDER_RECEIVED yet (the reported trip 729).
  const s1 = await lot('S1236-A', 'DISPATCHED');
  ff1Id = s1.ffId;
  await sql`update shipment_fulfillments set planned_carrier_type = 'OWN', planned_vehicle_plate_number = '29A-123.01' where id = ${ff1Id}`;
  const [trip1] = await sql`
    insert into trips (customer_id, route_id, departure_date, shipment_id, fulfillment_id, truck_id, driver_id, trailer_id, status)
    values (${customer.id}, ${route.id}, '2026-11-28', ${s1.lotId}, ${ff1Id}, ${truckA.id}, ${driverD1Id}, ${trailerAId}, 'CREATED')
    returning id`;
  trip1Id = trip1.id;
  await sql`insert into trip_carrier_info (trip_id, carrier_type) values (${trip1.id}, 'OWN')`;

  // S2 — issued EXTERNAL, IN_TRANSIT, driver accepted (the reported trip 727).
  const s2 = await lot('S1236-B', 'DISPATCHED');
  ff2Id = s2.ffId;
  await sql`update shipment_fulfillments set planned_carrier_type = 'EXTERNAL', planned_external_carrier_id = ${externalCarrierId}, planned_vehicle_plate_number = '58X-1236.1' where id = ${ff2Id}`;
  const [trip2] = await sql`
    insert into trips (customer_id, route_id, departure_date, shipment_id, fulfillment_id, status)
    values (${customer.id}, ${route.id}, '2026-11-28', ${s2.lotId}, ${ff2Id}, 'IN_TRANSIT')
    returning id`;
  trip2Id = trip2.id;
  await sql`insert into trip_carrier_info (trip_id, carrier_type, external_entity_id, external_entity_type, external_plate_number, external_driver_name, external_driver_phone)
    values (${trip2.id}, 'EXTERNAL', ${externalCarrierId}, 'CUSTOMER', '58X-1236.1', 'Tài Xế Ngoài', '0900000001')`;
  await sql`insert into driver_progress_events (trip_id, driver_id, event_type, occurred_at) values (${trip2.id}, ${driverD1Id}, 'ORDER_RECEIVED', now())`;

  // S3 — lot COMPLETED: the terminal lot gate dominates (live trip present).
  const s3 = await lot('S1236-C', 'COMPLETED');
  ff3Id = s3.ffId;

  // S4 — lot DISPATCHED but its trip COMPLETED: frozen history keeps the
  // issued-order refusal.
  const s4 = await lot('S1236-D', 'DISPATCHED');
  ff4Id = s4.ffId;
  await sql`update shipment_fulfillments set planned_carrier_type = 'OWN', planned_vehicle_plate_number = '29A-123.01' where id = ${ff4Id}`;
  await sql`
    insert into trips (customer_id, route_id, departure_date, shipment_id, fulfillment_id, truck_id, driver_id, trailer_id, status)
    values (${customer.id}, ${route.id}, '2026-11-28', ${s4.lotId}, ${ff4Id}, ${truckA.id}, ${driverD1Id}, ${trailerAId}, 'COMPLETED')`;

  // S5 — issued OWN, IN_TRANSIT, driver accepted: vehicle-only law (OWN side).
  const s5 = await lot('S1236-E', 'DISPATCHED');
  ff5Id = s5.ffId;
  await sql`update shipment_fulfillments set planned_carrier_type = 'OWN', planned_vehicle_plate_number = '29A-123.01' where id = ${ff5Id}`;
  const [trip5] = await sql`
    insert into trips (customer_id, route_id, departure_date, shipment_id, fulfillment_id, truck_id, driver_id, trailer_id, status)
    values (${customer.id}, ${route.id}, '2026-11-28', ${s5.lotId}, ${ff5Id}, ${truckA.id}, ${driverD1Id}, ${trailerAId}, 'IN_TRANSIT')
    returning id`;
  trip5Id = trip5.id;
  await sql`insert into trip_carrier_info (trip_id, carrier_type) values (${trip5.id}, 'OWN')`;
  await sql`insert into driver_progress_events (trip_id, driver_id, event_type, occurred_at) values (${trip5.id}, ${driverD1Id}, 'ORDER_RECEIVED', now())`;

  // S6 — issued OWN, CREATED: a tractor with no roster assignment must not
  // null the issued trip's driver.
  const s6 = await lot('S1236-F', 'DISPATCHED');
  ff6Id = s6.ffId;
  await sql`update shipment_fulfillments set planned_carrier_type = 'OWN', planned_vehicle_plate_number = '29A-123.01' where id = ${ff6Id}`;
  await sql`
    insert into trips (customer_id, route_id, departure_date, shipment_id, fulfillment_id, truck_id, driver_id, trailer_id, status)
    values (${customer.id}, ${route.id}, '2026-11-28', ${s6.lotId}, ${ff6Id}, ${truckA.id}, ${driverD1Id}, ${trailerAId}, 'CREATED')`;

  // Dynamic import is REQUIRED here: the router transitively imports db,
  // whose drizzle client binds DATABASE_URL at module init.
  const { dispatchPlanningRoutes } = await import('../routes/shipments/dispatch-planning.routes');

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { user?: unknown }).user = {
      userId: 2,
      username: 'dvqa',
      email: 'dvqa@test.vn',
      fullName: 'Điều Vận',
      role: Role.DISPATCHER,
    };
    next();
  });
  app.use('/api/shipments', dispatchPlanningRoutes);
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const statusCode = err instanceof ApiError ? err.statusCode : 500;
    res.status(statusCode).json({ error: err instanceof Error ? err.message : 'Lỗi máy chủ' });
  });

  server = app.listen(0);
  const { promise: listening, resolve: onListening } = Promise.withResolvers<void>();
  server.once('listening', onListening);
  await listening;
  const address = server.address();
  assert.ok(address && typeof address === 'object', 'server must expose a port');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  server?.close();
  await sql?.end();
  const admin = postgres('postgres://postgres:postgres@localhost:5441/postgres');
  await admin.unsafe(`DROP DATABASE IF EXISTS ${TMP_DB} WITH (FORCE)`);
  await admin.end();
});

describe('SIL-1236 — plan save on an issued row (KB §2.3.5)', () => {
  test('issued NOT accepted: the save passes and syncs truck/driver/trailer onto the live trip', async () => {
    const res = await patchPlan(ff1Id, { carrierType: 'OWN', truckId: truckBId }, { fulfillment: 1, shipment: 1 });
    assert.equal(res.status, 200);
    const body = await res.json() as {
      fulfillmentVersion: number;
      dispatch: { carrierType: string; carrierName: string; assignedPlate: string | null; assignedDriverName: string | null; driverAccepted: boolean };
    };
    assert.equal(body.dispatch.driverAccepted, false);
    assert.equal(body.dispatch.assignedPlate, '29B-456.02');
    assert.equal(body.dispatch.assignedDriverName, 'Tài Xế Hai');
    assert.equal(body.fulfillmentVersion, 2);

    // The live trip reflects the new assignment — the core of the fix.
    const [trip] = await sql`select truck_id, driver_id, trailer_id, version from trips where id = ${trip1Id}`;
    assert.equal(trip.truck_id, truckBId);
    assert.equal(trip.driver_id, driverD2Id);
    assert.equal(trip.trailer_id, trailerBId);
    assert.equal(trip.version, 2);
    const [carrierInfo] = await sql`select carrier_type, external_entity_id, external_plate_number from trip_carrier_info where trip_id = ${trip1Id}`;
    assert.equal(carrierInfo.carrier_type, 'OWN');
    assert.equal(carrierInfo.external_entity_id, null);

    const [ff] = await sql`select planned_carrier_type, planned_vehicle_plate_number from shipment_fulfillments where id = ${ff1Id}`;
    assert.equal(ff.planned_carrier_type, 'OWN');
    assert.equal(ff.planned_vehicle_plate_number, '29B-456.02');
  });

  test('unassign on a live issued trip is refused toward the Hủy phân xe flow', async () => {
    const res = await patchPlan(ff1Id, { carrierType: null }, { fulfillment: 2, shipment: 1 });
    assert.equal(res.status, 409);
    const body = await res.json() as { error: string };
    assert.match(body.error, /Hủy phân xe/);
    const [trip] = await sql`select truck_id from trips where id = ${trip1Id}`;
    assert.equal(trip.truck_id, truckBId);
  });

  test('same-assignment re-save is a no-op sync — no trip version churn', async () => {
    const res = await patchPlan(ff1Id, { carrierType: 'OWN', truckId: truckBId }, { fulfillment: 2, shipment: 1 });
    assert.equal(res.status, 200);
    const [trip] = await sql`select truck_id, driver_id, trailer_id, version from trips where id = ${trip1Id}`;
    assert.equal(trip.truck_id, truckBId);
    assert.equal(trip.version, 2, 'a save that changes nothing must not bump the trip version');
  });

  test('S6 driverless tractor: issued OWN trip refuses a tractor with no active assignment', async () => {
    const res = await patchPlan(ff6Id, { carrierType: 'OWN', truckId: truckCDriverlessId }, { fulfillment: 1, shipment: 1 });
    assert.equal(res.status, 400);
    const body = await res.json() as { error: string };
    assert.match(body.error, /chưa gán tài xế/);
  });

  test('accepted OWN: a driver-dimension tractor swap is refused with the reason + allowed path', async () => {
    const res = await patchPlan(ff5Id, { carrierType: 'OWN', truckId: truckBId }, { fulfillment: 1, shipment: 1 });
    assert.equal(res.status, 409);
    const body = await res.json() as { error: string };
    assert.equal(body.error, 'Lái xe đã nhận việc — chỉ được đổi xe, giữ lái xe.');
    const [trip] = await sql`select truck_id, driver_id, trailer_id, version from trips where id = ${trip5Id}`;
    assert.equal(trip.truck_id, truckAId);
    assert.equal(trip.driver_id, driverD1Id);
    assert.equal(trip.trailer_id, trailerAId);
    assert.equal(trip.version, 1);
  });

  test('accepted EXTERNAL: a plate change passes and syncs the carrier block', async () => {
    const res = await patchPlan(ff2Id, { carrierType: 'EXTERNAL', externalCarrierId, plateNumber: '58X-1236.2' }, { fulfillment: 1, shipment: 1 });
    assert.equal(res.status, 200);
    const body = await res.json() as { dispatch: { assignedPlate: string | null; driverAccepted: boolean } };
    assert.equal(body.dispatch.assignedPlate, '58X-1236.2');
    assert.equal(body.dispatch.driverAccepted, true);

    const [carrierInfo] = await sql`select carrier_type, external_entity_id, external_plate_number from trip_carrier_info where trip_id = ${trip2Id}`;
    assert.equal(carrierInfo.carrier_type, 'EXTERNAL');
    assert.equal(carrierInfo.external_entity_id, externalCarrierId);
    assert.equal(carrierInfo.external_plate_number, '58X-1236.2');
    const [trip] = await sql`select truck_id, driver_id, version from trips where id = ${trip2Id}`;
    assert.equal(trip.truck_id, null);
    assert.equal(trip.driver_id, null);
    assert.equal(trip.version, 2);
  });

  test('accepted EXTERNAL: changing the driver contact is refused', async () => {
    const res = await patchPlan(ff2Id, {
      carrierType: 'EXTERNAL',
      externalCarrierId,
      externalDriverName: 'Tài Xế Khác',
    }, { fulfillment: 2, shipment: 1 });
    assert.equal(res.status, 409);
    const body = await res.json() as { error: string };
    assert.equal(body.error, 'Lái xe đã nhận việc — chỉ được đổi xe, giữ lái xe.');
    const [carrierInfo] = await sql`select external_driver_name, external_plate_number from trip_carrier_info where trip_id = ${trip2Id}`;
    assert.equal(carrierInfo.external_driver_name, 'Tài Xế Ngoài');
    assert.equal(carrierInfo.external_plate_number, '58X-1236.2');
  });

  test('SIL-1244 mid-edit reception race: a snapshot from BEFORE the acceptance is refused with the "lái xe vừa nhận lệnh" reason and saves nothing', async () => {
    // The dialog loaded ff2 while the driver had NOT acknowledged
    // (expectedDriverAccepted: false) but the ORDER_RECEIVED milestone landed
    // before 'Lưu thay đổi' — KB §2.3.5: the stale edit must not save AND the
    // editor must learn the work was just received (content kept in the
    // dialog for đối chiếu), never a generic post-issuance refusal.
    const res = await patchPlan(ff2Id, {
      carrierType: 'EXTERNAL', externalCarrierId, plateNumber: '58X-1236.9', expectedDriverAccepted: false,
    }, { fulfillment: 2, shipment: 1 });
    assert.equal(res.status, 409);
    const body = await res.json() as { error: string };
    assert.equal(body.error, 'Lái xe vừa nhận lệnh công việc này trong lúc bạn đang sửa — bản sửa không được lưu. Nội dung được giữ để đối chiếu.');
    const [carrierInfo] = await sql`select external_plate_number from trip_carrier_info where trip_id = ${trip2Id}`;
    assert.equal(carrierInfo.external_plate_number, '58X-1236.2');
  });

  test('a COMPLETED lot still refuses with the lot message', async () => {
    const res = await patchPlan(ff3Id, { carrierType: 'OWN', truckId: truckAId }, { fulfillment: 1, shipment: 1 });
    assert.equal(res.status, 409);
    const body = await res.json() as { error: string };
    assert.equal(body.error, 'Lô hàng đã kết thúc, không thể lưu kế hoạch.');
  });

  test('a COMPLETED trip still refuses with the issued-order message', async () => {
    const res = await patchPlan(ff4Id, { carrierType: 'OWN', truckId: truckBId }, { fulfillment: 1, shipment: 1 });
    assert.equal(res.status, 409);
    const body = await res.json() as { error: string };
    assert.equal(body.error, 'Không thể sửa kế hoạch sau khi đã phát hành lệnh điều xe.');
  });
});

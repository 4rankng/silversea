// Q8 gate — POST /api/shipments/lcl/cost-group/update with `addShipmentIds`
// joins an ungrouped LCL lot into an EXISTING cost group: appended group
// order, cước trả zeroed on its live trip AND its fulfillment (the
// Lô-chính-100%/members-0₫ law), while an FCL lot 400s and an
// already-grouped lot 409s — the THÊM gates re-run per newcomer over the
// full new member set.
// Harness: throwaway schema-only DB behind the REAL lcl-grouping router with
// a stub auth layer (debit-merge-route-regression pattern).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import express from 'express';
import type { Server } from 'node:http';
import postgres from 'postgres';
import { ApiError } from '../errors';
import { Role } from '@tingting/shared';

const TMP_DB = `lcl_group_add_test_${Date.now().toString(36)}`;
const TMP_URL = 'postgres://postgres:postgres@localhost:5441/' + TMP_DB;
process.env.DATABASE_URL = TMP_URL;

const GROUP_A = 'a1111111-1111-4111-8111-111111111111';
const GROUP_D = 'b2222222-2222-4222-8222-222222222222';

let sql: postgres.Sql;
let server: Server;
let baseUrl: string;
let lotCId: number;
let lotDId: number;
let lotEId: number;
let tripCId: number;

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

  const [customer] = await sql`insert into customers (name, status) values ('Khách thêm lô', 'ACTIVE') returning id`;
  const [carrier] = await sql`insert into customers (name, status, is_carrier) values ('Nhà thầu Q8', 'ACTIVE', true) returning id`;
  void carrier;
  const [vehicleClass] = await sql`insert into vehicle_size_classes (code, name) values ('3T5ADD', 'Xe tải 3.5T') returning id`;
  const [route] = await sql`insert into routes (name) values ('Tuyến thêm lô') returning id`;

  const [lotA] = await sql`
    insert into shipments (customer_id, cargo_mode, shipment_code, status, cost_group_id, cost_group_order, actual_truck_no, cost_vehicle_class_id)
    values (${customer.id}, 'LCL', 'Q8-A', 'PENDING_DATE', ${GROUP_A}, 1, '59H-111.11', ${vehicleClass.id})
    returning id`;
  const [lotB] = await sql`
    insert into shipments (customer_id, cargo_mode, shipment_code, status, cost_group_id, cost_group_order, actual_truck_no, cost_vehicle_class_id)
    values (${customer.id}, 'LCL', 'Q8-B', 'PENDING_DATE', ${GROUP_A}, 2, '59H-111.11', ${vehicleClass.id})
    returning id`;
  const [lotC] = await sql`
    insert into shipments (customer_id, cargo_mode, shipment_code, status)
    values (${customer.id}, 'LCL', 'Q8-C', 'PENDING_DATE')
    returning id`;
  const [lotD] = await sql`
    insert into shipments (customer_id, cargo_mode, shipment_code, status, cost_group_id, cost_group_order, actual_truck_no, cost_vehicle_class_id)
    values (${customer.id}, 'LCL', 'Q8-D', 'PENDING_DATE', ${GROUP_D}, 1, '60H-222.22', ${vehicleClass.id})
    returning id`;
  const [lotE] = await sql`
    insert into shipments (customer_id, cargo_mode, shipment_code, status)
    values (${customer.id}, 'FCL', 'Q8-E', 'PENDING_DATE')
    returning id`;
  void lotA; void lotB;
  lotCId = lotC.id;
  lotDId = lotD.id;
  lotEId = lotE.id;

  await sql`
    insert into shipment_fulfillments (shipment_id, fulfillment_type, cargo_mode, dispatch_classification, source_shipment_version)
    values (${lotC.id}, 'LCL_SHIPMENT', 'LCL', 'LCL', 1)`;
  const [tripC] = await sql`
    insert into trips (customer_id, route_id, departure_date, shipment_id)
    values (${customer.id}, ${route.id}, '2026-11-27', ${lotC.id})
    returning id`;
  tripCId = tripC.id;

  const { lclGroupingRoutes } = await import('../routes/shipments/lcl-grouping.routes');
  // Dynamic import is REQUIRED here (shipment-children-fk pattern): the router
  // transitively imports db, whose drizzle client binds DATABASE_URL at module
  // init — a static import would bind the DEV database before before() points
  // the env at the throwaway one above.

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
  app.use('/api/shipments', lclGroupingRoutes);
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

function postUpdate(body: Record<string, unknown>) {
  return fetch(`${baseUrl}/api/shipments/lcl/cost-group/update`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /lcl/cost-group/update with addShipmentIds (Q8)', () => {
  test('an ungrouped LCL lot joins the group and its cước trả zeroes', async () => {
    const res = await postUpdate({ groupId: GROUP_A, addShipmentIds: [lotCId] });
    assert.equal(res.status, 200);
    const body = await res.json() as { memberCount: number; members: Array<{ shipmentId: number; order: number }> };
    assert.equal(body.memberCount, 3);
    assert.deepEqual(body.members.map((member) => member.shipmentId).sort((a, b) => a - b), [body.members[0]!.shipmentId, body.members[1]!.shipmentId, lotCId].sort((a, b) => a - b));

    const [joined] = await sql`select cost_group_id, cost_group_order from shipments where id = ${lotCId}`;
    assert.equal(joined.cost_group_id, GROUP_A);
    assert.equal(joined.cost_group_order, 3);

    const [carrierInfo] = await sql`select carrier_type, external_freight_cost from trip_carrier_info where trip_id = ${tripCId}`;
    assert.ok(carrierInfo, 'the joined lot\'s live trip must carry the group carrier');
    assert.equal(carrierInfo.carrier_type, 'EXTERNAL');
    assert.equal(carrierInfo.external_freight_cost, '0');

    const [fulfillment] = await sql`select planned_carrier_cost from shipment_fulfillments where shipment_id = ${lotCId}`;
    assert.equal(fulfillment.planned_carrier_cost, '0');
  });

  test('an FCL lot is refused with 400', async () => {
    const res = await postUpdate({ groupId: GROUP_A, addShipmentIds: [lotEId] });
    assert.equal(res.status, 400);
  });

  test('an already-grouped lot is refused with 409', async () => {
    const res = await postUpdate({ groupId: GROUP_A, addShipmentIds: [lotDId] });
    assert.equal(res.status, 409);
  });
});

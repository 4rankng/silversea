// SIL-1224 (KB Ch.4 §4.1.7, K4.30) — POST /api/shipments/lcl/cost-group with
// a nhà xe NGOÀI and NO plate yet: the group IS saved (the run carries "chưa
// có biển", the plate rides in later through "Đổi BKS nhóm") — the same law
// the single-lot flow already ships (card 20261004_359). The internal fleet
// keeps the hard rule: its tractor is always a registered one.
//
// Harness: throwaway schema-only DB behind the REAL lcl-grouping router with
// a stub auth layer (same pattern as the sibling lcl-cost-group-add-members
// test).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import express from 'express';
import type { Server } from 'node:http';
import postgres from 'postgres';
import { ApiError } from '../errors';
import { Role } from '@tingting/shared';

const TMP_DB = `lcl_group_deferred_plate_${Date.now().toString(36)}`;
const TMP_URL = 'postgres://postgres:postgres@localhost:5441/' + TMP_DB;
process.env.DATABASE_URL = TMP_URL;

let sql: postgres.Sql;
let server: Server;
let baseUrl: string;
let lotOneId: number;
let lotTwoId: number;
let containerClassId: number;
let carrierId: number;

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

  const [customer] = await sql`insert into customers (name, status) values ('Khách biển trễ', 'ACTIVE') returning id`;
  const [carrier] = await sql`insert into customers (name, status, is_carrier) values ('Nhà thầu chưa có biển', 'ACTIVE', true) returning id`;
  carrierId = carrier.id;
  // A CONTAINER class: the sourcing rule admits the internal fleet OR a nhà
  // xe, so the plate rule is the only thing under test.
  const [vehicleClass] = await sql`insert into vehicle_size_classes (code, name, is_container) values ('CONT20D', 'Container 20 feet', true) returning id`;
  containerClassId = vehicleClass.id;
  const [route] = await sql`insert into routes (name) values ('Tuyến biển trễ') returning id`;

  const lots: number[] = [];
  for (const code of ['DP-1', 'DP-2']) {
    const [lot] = await sql`
      insert into shipments (customer_id, cargo_mode, shipment_code, status)
      values (${customer.id}, 'LCL', ${code}, 'PENDING_DATE')
      returning id`;
    await sql`
      insert into shipment_fulfillments (shipment_id, fulfillment_type, cargo_mode, dispatch_classification, source_shipment_version)
      values (${lot.id}, 'LCL_SHIPMENT', 'LCL', 'LCL', 1)`;
    await sql`
      insert into trips (customer_id, route_id, departure_date, shipment_id)
      values (${customer.id}, ${route.id}, '2026-11-28', ${lot.id})`;
    lots.push(lot.id);
  }
  lotOneId = lots[0]!;
  lotTwoId = lots[1]!;

  const { lclGroupingRoutes } = await import('../routes/shipments/lcl-grouping.routes');
  // Dynamic import is REQUIRED (shipment-children-fk pattern): the router
  // transitively imports db, whose drizzle client binds DATABASE_URL at module
  // init — a static import would bind the DEV database.
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

function postAssign(body: Record<string, unknown>) {
  return fetch(`${baseUrl}/api/shipments/lcl/cost-group`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /lcl/cost-group — nhà xe ngoài chưa có biển (SIL-1224)', () => {
  test('xe ngoài để trống BKS thực → gán được, nhóm lưu NULL (chạy "chưa có biển")', async () => {
    const res = await postAssign({
      shipmentIds: [lotOneId, lotTwoId],
      vehicleSizeClassId: containerClassId,
      actualTruckNo: '',
      carrierId,
      carrierType: 'EXTERNAL',
    });
    assert.equal(res.status, 201);
    const body = await res.json() as { groupId: string; memberCount: number };
    assert.equal(body.memberCount, 2);
    assert.ok(body.groupId);

    // The group's members carry NO plate — NULL, never '' (the plan row reads
    // "chờ bổ sung biển").
    const members = await sql`
      select actual_truck_no, cost_group_id, cost_group_order
      from shipments where id in (${lotOneId}, ${lotTwoId}) order by cost_group_order`;
    assert.equal(members.length, 2);
    for (const member of members) {
      assert.equal(member.actual_truck_no, null);
      assert.equal(member.cost_group_id, body.groupId);
    }

    // The plan assignment keeps the carrier and leaves the plate empty.
    const fulfillments = await sql`
      select planned_carrier_type, planned_external_carrier_id, planned_vehicle_plate_number
      from shipment_fulfillments where shipment_id in (${lotOneId}, ${lotTwoId})`;
    assert.equal(fulfillments.length, 2);
    for (const fulfillment of fulfillments) {
      assert.equal(fulfillment.planned_carrier_type, 'EXTERNAL');
      assert.equal(fulfillment.planned_external_carrier_id, carrierId);
      assert.equal(fulfillment.planned_vehicle_plate_number, null);
    }
  });

  test('xe nội bộ để trống BKS thực → bị chặn, nhóm không được tạo', async () => {
    const res = await postAssign({
      shipmentIds: [lotOneId, lotTwoId],
      vehicleSizeClassId: containerClassId,
      actualTruckNo: '',
      carrierType: 'OWN',
    });
    assert.notEqual(res.status, 201);
    const body = await res.json() as { error?: string };
    assert.match(String(body.error), /BKS không được để trống/);
  });

  test('nguồn xe không khai báo + BKS rỗng → bị chặn (server tự suy ra nguồn xe)', async () => {
    const res = await postAssign({
      shipmentIds: [lotOneId, lotTwoId],
      vehicleSizeClassId: containerClassId,
      actualTruckNo: '',
    });
    assert.notEqual(res.status, 201);
  });
});

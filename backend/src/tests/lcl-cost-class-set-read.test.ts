// K9.2/K9.18 — "Loại xe tính cước trả nhà xe" (shipments.costVehicleClassId):
// nửa TRẢ của nhãn "Lô hàng lẻ | Thu: Xe … | Trả: Xe …". Scoped contract —
// ĐẶT: POST /api/shipments/lcl/cost-class ghi cột cost_vehicle_class_id và
// trả code danh mục; ĐỌC: dây chuyền nhãn (/shipments-debit debit-summary)
// thấy costVehicleClassCode để dựng nửa Trả. Xe thu và xe trả độc lập nhau.
// Harness: throwaway schema-only DB (the shipment-children-fk pattern) behind
// the REAL lcl-grouping + shipment core routers with a stub auth layer.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import express from 'express';
import type { Server } from 'node:http';
import postgres from 'postgres';
import type { Sql } from 'postgres';
import { ApiError } from '../errors';
import { Role } from '@tingting/shared';

const TMP_DB = `lcl_cost_class_test_${Date.now().toString(36)}`;
const TMP_URL = 'postgres://postgres:postgres@localhost:5441/' + TMP_DB;
// Must precede every dynamic import of db-touching modules: db/config reads
// this at module init, and a static import would bind drizzle to the DEV
// database before the test can point it at the throwaway one.
process.env.DATABASE_URL = TMP_URL;

let sql: Sql;
let app: express.Express;
let server: Server;
let baseUrl: string;
let shipmentId: number;
let classId: number;

before(async () => {
  const admin = postgres('postgres://postgres:postgres@localhost:5441/postgres');
  await admin.unsafe(`CREATE DATABASE ${TMP_DB}`);
  await admin.end();
  const dump = execFileSync(
    'docker',
    ['exec', 'ss-prod-db', 'pg_dump', '-U', 'postgres', '-d', 'silversea', '--schema-only'],
    { encoding: 'utf8', timeout: 120000 },
  );
  // pg_dump ≥17 emits psql meta-commands (\restrict …) postgres.js cannot run.
  const dumpSql = dump.split('\n').filter((line) => !line.startsWith('\\')).join('\n');
  const restore = postgres(TMP_URL);
  await restore.unsafe(dumpSql);
  await restore.end();
  sql = postgres(TMP_URL);

  const [user] = await sql`insert into users (username, email, full_name, password_hash, role)
    values ('quantri-cost-class', 'qcc@test.vn', 'Quản Trị Cost Class', 'x', 'ADMIN') returning id`;
  const [customer] = await sql`insert into customers (name) values ('Khách cost-class') returning id`;
  const [shipment] = await sql`
    insert into shipments (customer_id, cargo_mode, shipment_code, status, created_by)
    values (${customer.id}, 'LCL', 'CC-TEST-1', 'PENDING_DATE', ${user.id})
    returning id`;
  shipmentId = shipment.id;
  const [vehicleClass] = await sql`
    insert into vehicle_size_classes (code, name, is_container, sort_order)
    values ('10T', 'Xe 10 tấn', false, 7)
    returning id`;
  classId = vehicleClass.id;

  // Dynamic import is REQUIRED here (shipment-children-fk pattern): the
  // routers transitively import db, whose drizzle client binds DATABASE_URL
  // at module init — a static import would bind the DEV database before
  // before() points the env at the throwaway one above.
  const { lclGroupingRoutes } = await import('../routes/shipments/lcl-grouping.routes');
  const { coreRoutes } = await import('../routes/shipments/core.routes');

  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    // Express's Request type has no `user`; the auth middleware fills it in production.
    const authed = req as express.Request & { user?: unknown };
    authed.user = {
      userId: user.id,
      username: 'quantri-cost-class',
      email: 'qcc@test.vn',
      fullName: 'Quản Trị Cost Class',
      role: Role.ADMIN,
    };
    next();
  });
  app.use('/api/shipments', lclGroupingRoutes);
  app.use('/api/shipments', coreRoutes);
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
  if (sql) await sql.end();
  // The routers' drizzle pool (backend/src/db) still holds connections to the
  // throwaway DB — same dynamic-import reason as above. Close it, then
  // FORCE-drop like the sibling harness.
  const { client } = await import('../db');
  await client.end({ timeout: 5 });
  const admin = postgres('postgres://postgres:postgres@localhost:5441/postgres');
  await admin.unsafe(`DROP DATABASE IF EXISTS ${TMP_DB} WITH (FORCE)`);
  await admin.end();
});

describe('K9.2/K9.18 — costVehicleClassId: đặt qua /lcl/cost-class, đọc qua wire nhãn', () => {
  test('đặt: POST /lcl/cost-class ghi cột cost_vehicle_class_id và trả code danh mục', async () => {
    const res = await fetch(`${baseUrl}/api/shipments/lcl/cost-class`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shipmentId, vehicleSizeClassId: classId }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    const code: unknown = body && typeof body === 'object' && 'costVehicleClassCode' in body ? body.costVehicleClassCode : null;
    assert.equal(code, '10T', 'phản hồi trả code danh mục của loại xe trả vừa lưu');

    const [row] = await sql`select cost_vehicle_class_id from shipments where id = ${shipmentId}`;
    const stored: unknown = row?.cost_vehicle_class_id;
    assert.equal(stored, classId, 'cột cost_vehicle_class_id phải được ghi');
  });

  test('đọc: wire nhãn (/shipments-debit debit-summary) trả costVehicleClassCode', async () => {
    const res = await fetch(`${baseUrl}/api/shipments/debit-summary`);
    assert.equal(res.status, 200);
    const body = await res.json();
    const items: unknown = body && typeof body === 'object' && 'items' in body ? body.items : null;
    assert.ok(Array.isArray(items), 'debit-summary trả về danh sách dòng lô');
    const row = items.find((item) => item !== null && typeof item === 'object' && 'shipmentId' in item && item.shipmentId === shipmentId);
    assert.ok(row, 'lô vừa đặt loại xe trả phải có trên dây chuyền nhãn');
    const code: unknown = row !== null && typeof row === 'object' && 'costVehicleClassCode' in row ? row.costVehicleClassCode : null;
    assert.equal(code, '10T', 'nửa Trả của nhãn đọc được code loại xe trả');
  });
});

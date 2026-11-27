// CR-011.2 Q6 — endpoint gate: the debit board AND the settlement summary
// carry each lot's live KẸP pair code (trips.active_trip_pair_id of the
// lot's live trips). A paired lot reads its pair id on BOTH payloads; a lot
// with no live pair stays null (never a fabricated id).
// Harness: throwaway schema-only DB behind the REAL accounting-debit router
// (debit-merge-route-regression pattern).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import express from 'express';
import type { Server } from 'node:http';
import postgres from 'postgres';
import { ApiError } from '../errors';
import { Role } from '@tingting/shared';

const TMP_DB = `debit_pair_id_test_${Date.now().toString(36)}`;
const TMP_URL = 'postgres://postgres:postgres@localhost:5441/' + TMP_DB;
// Must precede every dynamic import of db-touching modules (db/config reads
// this at module init).
process.env.DATABASE_URL = TMP_URL;

let sql: postgres.Sql;
let server: Server;
let baseUrl: string;
let pairedLotId: number;
let unpairedLotId: number;

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

  const [customer] = await sql`insert into customers (name, status) values ('Khách mã cặp', 'ACTIVE') returning id`;
  const [paired] = await sql`
    insert into shipments (customer_id, cargo_mode, shipment_code, status)
    values (${customer.id}, 'LCL', 'PAIR-PAIRED-1', 'PENDING_DATE')
    returning id`;
  const [unpaired] = await sql`
    insert into shipments (customer_id, cargo_mode, shipment_code, status)
    values (${customer.id}, 'LCL', 'PAIR-BLANK-2', 'PENDING_DATE')
    returning id`;
  pairedLotId = paired.id;
  unpairedLotId = unpaired.id;
  const [route] = await sql`insert into routes (name) values ('Tuyến mã cặp') returning id`;
  await sql`
    insert into trips (customer_id, route_id, departure_date, shipment_id, active_trip_pair_id)
    values (${customer.id}, ${route.id}, '2026-11-27', ${paired.id}, 42)`;

  const { default: accountingDebitRoutes } = await import('../routes/accounting-debit');
  // Dynamic import is REQUIRED here (shipment-children-fk pattern): the router
  // transitively imports db, whose drizzle client binds DATABASE_URL at module
  // init — a static import would bind the DEV database before before() points
  // the env at the throwaway one above.

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { user?: unknown }).user = {
      userId: 1,
      username: 'hoapt',
      email: 'hoapt@test.vn',
      fullName: 'Kế Toán',
      role: Role.ACCOUNTANT,
    };
    next();
  });
  app.use('/api/accounting', accountingDebitRoutes);
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

describe('GET /api/accounting/debit-merge — pair id rides the board rows', () => {
  test('the paired lot carries pairId 42, the unpaired one stays null', async () => {
    const res = await fetch(`${baseUrl}/api/accounting/debit-merge`);
    assert.equal(res.status, 200);
    const body = await res.json() as { items: Array<{ shipmentId: number; pairId: number | null }> };
    const paired = body.items.find((item) => item.shipmentId === pairedLotId);
    const blank = body.items.find((item) => item.shipmentId === unpairedLotId);
    assert.ok(paired, 'paired lot must ride the board');
    assert.ok(blank, 'unpaired lot must ride the board');
    assert.equal(paired.pairId, 42);
    assert.equal(blank.pairId, null);
  });
});

describe('GET summary service — pair id rides the summary rows', () => {
  test('the summary item carries the same live pair id', async () => {
    const { getShipmentDebitSummary } = await import('../services/shipment-debit-summary.service');
    // Same REQUIRED dynamic import as the router above: the service module
    // binds DATABASE_URL at its init, which before() must point first.
    const summary = await getShipmentDebitSummary({
      lockStatus: 'ALL',
      viewerRole: Role.ADMIN,
      actor: { userId: 1, username: 'admin', email: 'admin@test.vn', fullName: 'Quản trị', role: Role.ADMIN },
    });
    const paired = summary.items.find((item) => item.shipmentId === pairedLotId);
    const blank = summary.items.find((item) => item.shipmentId === unpairedLotId);
    assert.ok(paired, 'paired lot must ride the summary');
    assert.ok(blank, 'unpaired lot must ride the summary');
    assert.equal(paired.pairId, 42);
    assert.equal(blank.pairId, null);
  });
});

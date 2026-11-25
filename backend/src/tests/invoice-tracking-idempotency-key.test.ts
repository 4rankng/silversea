// K6.14 — Mười thao tác ghi tài chính bắt buộc dùng mã chống ghi trùng: thiếu
// mã thì bị từ chối, lặp lại cùng mã thì chỉ ghi một lần, dùng mã khác cho nội
// dung khác thì bị từ chối. The Theo dõi hóa đơn PATCH is the named repro
// surface (API, vai trò Kế toán): PATCH /api/accounting/invoice-tracking/:id.
// This gate pins all three clauses against the REAL router + runIdempotent so
// the "thiếu mã → bị từ chối" contract can never silently regress to the old
// "No key → no dedupe" behavior again.
// Harness: throwaway schema-only DB (the shipment-children-fk pattern) behind
// the REAL accounting router with a stub auth layer — same shape as
// debit-merge-route-regression.test.ts.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import express from 'express';
import type { Server } from 'node:http';
import postgres from 'postgres';
import type { Sql } from 'postgres';
import { ApiError } from '../errors';
import { Role } from '@tingting/shared';

const TMP_DB = `invoice_tracking_idem_test_${Date.now().toString(36)}`;
const TMP_URL = 'postgres://postgres:postgres@localhost:5441/' + TMP_DB;
// Must precede every dynamic import of db-touching modules: db/config reads
// this at module init, and a static import would bind drizzle to the DEV
// database before the test can point it at the throwaway one.
process.env.DATABASE_URL = TMP_URL;

let sql: Sql;
let app: express.Express;
let server: Server;
let baseUrl: string;
let trackerId: number;

async function patchTracker(body: Record<string, unknown>, idempotencyKey?: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}/api/accounting/invoice-tracking/${trackerId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function trackerNote(): Promise<string | null> {
  const [row] = await sql`select note from invoice_tracking where id = ${trackerId}`;
  const value: unknown = row?.note;
  return typeof value === 'string' ? value : null;
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
  // pg_dump ≥17 emits psql meta-commands (\restrict …) postgres.js cannot run.
  const dumpSql = dump.split('\n').filter((line) => !line.startsWith('\\')).join('\n');
  const restore = postgres(TMP_URL);
  await restore.unsafe(dumpSql);
  await restore.end();
  sql = postgres(TMP_URL);

  const [accountant] = await sql`insert into users (username, email, full_name, password_hash, role)
    values ('ketoan-idem', 'ketoan-idem@test.vn', 'Kế Toán Idem', 'x', 'ACCOUNTANT') returning id`;
  const [customer] = await sql`insert into customers (name) values ('Khách idempotency-key') returning id`;
  const [shipment] = await sql`
    insert into shipments (customer_id, cargo_mode, shipment_code, status, created_by)
    values (${customer.id}, 'FCL', 'IDEM-TRACK-1', 'PENDING_DATE', ${accountant.id})
    returning id`;
  const [tracker] = await sql`
    insert into invoice_tracking (shipment_id, invoice_number, invoice_amount, supplier_payment, note)
    values (${shipment.id}, 'IDEM-HD-1', 1000000, 600000, 'GỐC')
    returning id`;
  trackerId = tracker.id;

  // Dynamic import is REQUIRED here (shipment-children-fk pattern): the router
  // transitively imports db, whose drizzle client binds DATABASE_URL at module
  // init — a static import would bind the DEV database before before() points
  // the env at the throwaway one above.
  const { default: accountingRoutes } = await import('../routes/accounting');

  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    // Express's Request type has no `user`; the auth middleware fills it in production.
    const authed = req as express.Request & { user?: unknown };
    authed.user = {
      userId: accountant.id,
      username: 'ketoan-idem',
      email: 'ketoan-idem@test.vn',
      fullName: 'Kế Toán Idem',
      role: Role.ACCOUNTANT,
    };
    next();
  });
  app.use('/api/accounting', accountingRoutes);
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
  // The router's drizzle pool (backend/src/db) still holds connections to the
  // throwaway DB — same dynamic-import reason as above (env bound at module
  // init). Close it, then FORCE-drop like the sibling harness.
  const { client } = await import('../db');
  await client.end({ timeout: 5 });
  const admin = postgres('postgres://postgres:postgres@localhost:5441/postgres');
  await admin.unsafe(`DROP DATABASE IF EXISTS ${TMP_DB} WITH (FORCE)`);
  await admin.end();
});

describe('K6.14 — PATCH theo dõi hóa đơn: hợp đồng mã chống ghi trùng', () => {
  test('thiếu Idempotency-Key → bị từ chối, không ghi', async () => {
    const { status, body } = await patchTracker({ note: 'QA4B idem C' });
    assert.ok(status === 400 || status === 428, `thiếu mã phải bị từ chối 400/428, nhận ${status}`);
    const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : '';
    assert.match(message, /Idempotency-Key/);
    assert.equal(await trackerNote(), 'GỐC', 'dòng theo dõi không được ghi khi thiếu mã');
  });

  test('đủ Key + nội dung mới → 200, ghi như cũ', async () => {
    const { status } = await patchTracker({ note: 'QA4B idem A' }, 'idem-A-1');
    assert.equal(status, 200);
    assert.equal(await trackerNote(), 'QA4B idem A');
  });

  test('cùng Key + nội dung khác → 409, không đè kết quả cũ', async () => {
    const { status } = await patchTracker({ note: 'QA4B idem B' }, 'idem-A-1');
    assert.equal(status, 409);
    assert.equal(await trackerNote(), 'QA4B idem A', 'nội dung khác với cùng mã không được ghi');
  });

  test('cùng Key + cùng nội dung lặp lại → chỉ ghi một lần', async () => {
    const first = await patchTracker({ note: 'QA4B idem D' }, 'idem-D-1');
    assert.equal(first.status, 200);
    const replay = await patchTracker({ note: 'QA4B idem D' }, 'idem-D-1');
    assert.equal(replay.status, 200);
    assert.deepEqual(replay.body, first.body, 'lần gửi lại trả đúng kết quả đã ghi');
    assert.equal(await trackerNote(), 'QA4B idem D');
    const rows = await sql`
      select id from idempotency_keys
      where endpoint = 'accounting.invoice-tracking.update' and idempotency_key = 'idem-D-1'`;
    assert.equal(rows.length, 1, 'một mã chỉ được ghi nhận đúng một bản ghi chống ghi trùng');
  });
});

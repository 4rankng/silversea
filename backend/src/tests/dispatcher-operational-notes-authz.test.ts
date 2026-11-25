// CR-011 Task 4.1 — the dispatcher's note-only write path. A dedicated
// PATCH /api/shipments/:id/operational-notes grants DISPATCHER (plus ADMIN,
// MANAGER, CUS) write access to the dispatch notes ONLY, while the full
// metadata PUT /:id stays ADMIN/MANAGER/CUS (SIL-706 law — a dispatcher
// still cannot edit lot metadata). Runs against a throwaway DB (schema-only
// dump of the dev schema) through the REAL route stack with a stub auth
// layer, mirroring cus-write-audit-field-diff.test.ts.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import express from 'express';
import type { Server } from 'node:http';
import postgres from 'postgres';
import { ApiError } from '../errors';
import { Role } from '@tingting/shared';
import type { AuthUser } from '../middleware/auth';

const TMP_DB = `notes_authz_test_${Date.now().toString(36)}`;
const TMP_URL = 'postgres://postgres:postgres@localhost:5441/' + TMP_DB;
// Must precede every import of db-touching modules (db/config read this at
// module init); the app modules import dynamically inside before().
process.env.DATABASE_URL = TMP_URL;

let sql: postgres.Sql;
let app: express.Express;
let server: Server;
let baseUrl: string;
let dispatcher: number;
let accountant: number;
let shipmentId: number;
/** Role the stub auth layer hands to the stack for the next request. */
let actingRole: Role = Role.DISPATCHER;

function headers(idempotencyKey: string): Record<string, string> {
  return { 'content-type': 'application/json', 'Idempotency-Key': idempotencyKey };
}

async function patchNotes(body: Record<string, unknown>, key: string): Promise<Response> {
  return fetch(`${baseUrl}/api/shipments/${shipmentId}/operational-notes`, {
    method: 'PATCH', headers: headers(key), body: JSON.stringify(body),
  });
}

async function putFullMetadata(body: Record<string, unknown>, key: string): Promise<Response> {
  return fetch(`${baseUrl}/api/shipments/${shipmentId}`, {
    method: 'PUT', headers: headers(key), body: JSON.stringify(body),
  });
}

async function row(): Promise<{ operational_notes: string | null; version: number }> {
  const [r] = await sql`select operational_notes, version from shipments where id = ${shipmentId}`;
  return r;
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

  const [dispatcherRow] = await sql`insert into users (username, email, full_name, password_hash, role)
    values ('notes-dispatcher', 'nd@test.vn', 'Điều vận ghi chú', 'x', 'DISPATCHER') returning id`;
  dispatcher = dispatcherRow.id;
  const [accountantRow] = await sql`insert into users (username, email, full_name, password_hash, role)
    values ('notes-accountant', 'na@test.vn', 'Kế toán ghi chú', 'x', 'ACCOUNTANT') returning id`;
  accountant = accountantRow.id;
  const [customer] = await sql`insert into customers (name) values ('Khách notes-authz') returning id`;
  const [shipment] = await sql`
    insert into shipments (customer_id, cargo_mode, shipment_code, status, created_by, operational_notes)
    values (${customer.id}, 'FCL', 'NOTE-AUTHZ-1', 'PENDING_DATE', ${dispatcher}, 'Ghi chú cũ')
    returning id`;
  shipmentId = shipment.id;

  const { auditLogMiddleware } = await import('../middleware/audit');
  const { coreRoutes } = await import('../routes/shipments/core.routes');

  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = actingRole === Role.DISPATCHER ? dispatcher : accountant;
    (req as express.Request & { user?: AuthUser }).user = {
      userId,
      username: actingRole === Role.DISPATCHER ? 'notes-dispatcher' : 'notes-accountant',
      email: null,
      fullName: actingRole === Role.DISPATCHER ? 'Điều vận ghi chú' : 'Kế toán ghi chú',
      role: actingRole,
    };
    next();
  });
  app.use(auditLogMiddleware);
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
  const cleanup = postgres('postgres://postgres:postgres@localhost:5441/postgres');
  await cleanup.unsafe(`DROP DATABASE IF EXISTS ${TMP_DB} WITH (FORCE)`);
  await cleanup.end();
});

describe('CR-011 — dispatcher operational-notes route (note-only RBAC)', () => {
  test('DISPATCHER saves the dispatch notes through the dedicated route and it persists', async () => {
    actingRole = Role.DISPATCHER;
    const beforeRow = await row();
    const res = await patchNotes(
      { expectedVersion: beforeRow.version, operationalNotes: 'Giao hàng sau 14h, gọi công nhân kho.' },
      'cr011-notes-dispatcher-1',
    );
    const body = await res.json() as { version: number; operationalNotes: string | null; error?: string };
    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(body)}`);
    assert.equal(body.operationalNotes, 'Giao hàng sau 14h, gọi công nhân kho.');
    assert.equal(body.version, beforeRow.version + 1);
    const afterRow = await row();
    assert.equal(afterRow.operational_notes, 'Giao hàng sau 14h, gọi công nhân kho.');
    assert.equal(afterRow.version, beforeRow.version + 1);
  });

  test('a stale version still refuses with 409 (optimistic lock kept)', async () => {
    actingRole = Role.DISPATCHER;
    const current = await row();
    const res = await patchNotes(
      { expectedVersion: current.version - 1, operationalNotes: 'Phiên bản cũ.' },
      'cr011-notes-dispatcher-2',
    );
    assert.equal(res.status, 409);
    // The stored note is untouched by the refused write.
    assert.equal((await row()).operational_notes, 'Giao hàng sau 14h, gọi công nhân kho.');
  });

  test('DISPATCHER still cannot edit full lot metadata (SIL-706 preserved)', async () => {
    actingRole = Role.DISPATCHER;
    const res = await putFullMetadata({ expectedVersion: 1 }, 'cr011-notes-dispatcher-3');
    assert.equal(res.status, 403);
    assert.equal((await row()).operational_notes, 'Giao hàng sau 14h, gọi công nhân kho.');
  });

  test('ACCOUNTANT is outside the notes route role list (dispatcher-only grant per CR-011)', async () => {
    actingRole = Role.ACCOUNTANT;
    const res = await patchNotes(
      { expectedVersion: 1, operationalNotes: 'Kế toán không được sửa ghi chú điều phối.' },
      'cr011-notes-accountant-1',
    );
    assert.equal(res.status, 403);
    // The stored note is untouched by the refused write.
    assert.equal((await row()).operational_notes, 'Giao hàng sau 14h, gọi công nhân kho.');
  });
});

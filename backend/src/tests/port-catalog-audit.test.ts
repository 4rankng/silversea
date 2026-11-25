// K4.61 (SIL-1046) — the port catalog edit closes the audit + blast-radius
// loop: the audit row carries the OLD value beside the new one (metadata
// changes[]), an unchanged resubmit writes no phantom diff, the pre-save
// usage endpoint answers with the referencing trips/containers, and the save
// notifies the drivers of the live trips plus the Ops role on the existing
// in-app notification channel.
//
// Runs against a throwaway DB (schema-only dump of the dev schema) through
// the REAL route stack: express + auditLogMiddleware + the catalog crud
// router, with a stub auth layer supplying the acting user.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import express from 'express';
import type { Server } from 'node:http';
import postgres from 'postgres';
import { ApiError } from '../errors';
import { Role } from '@tingting/shared';
import type { AuthUser } from '../middleware/auth';

const TMP_DB = `port_catalog_audit_test_${Date.now().toString(36)}`;
const TMP_URL = 'postgres://postgres:postgres@localhost:5441/' + TMP_DB;
// Must precede every import of db-touching modules (see cus-write-audit-field-diff).
process.env.DATABASE_URL = TMP_URL;

let sql: postgres.Sql;
let app: express.Express;
let server: Server;
let baseUrl: string;
let adminUserId: number;
let opsUserId: number;
let driverUserId: number;
let driverId: number;
let portId: number;
const idempotencySeq: { n: number } = { n: 0 };

interface AuditPayload {
  event?: string;
  body?: Record<string, unknown>;
  changes?: Array<{ field: string; before: unknown; after: unknown }>;
  [key: string]: unknown;
}

function nextIdempotencyKey(): string {
  idempotencySeq.n += 1;
  return `port-audit-${idempotencySeq.n}`;
}

async function putPort(body: Record<string, unknown>, expectedUpdatedAt?: string): Promise<Response> {
  return fetch(`${baseUrl}/api/ports/${portId}`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'Idempotency-Key': nextIdempotencyKey(),
      ...(expectedUpdatedAt ? { 'If-Unmodified-Since': expectedUpdatedAt } : {}),
    },
    body: JSON.stringify(body),
  });
}

/** The port's current updated_at as the optimistic-lock token — read through
 *  the API itself (the production flow): the server's JSON serialization is
 *  the exact string the server will compare against. */
async function currentPortVersion(): Promise<string> {
  const res = await fetch(`${baseUrl}/api/ports/${portId}`);
  if (res.status !== 200) throw new Error(`port read should succeed: ${res.status} ${await res.text()}`);
  const port = await res.json() as { updatedAt: string };
  return port.updatedAt;
}

async function portAuditRows(): Promise<AuditPayload[]> {
  const rows = await sql`
    select payload from audit_logs
    where entity_type = 'ports' and payload->>'path' like ${`%/api/ports/${portId}%`}
    order by id`;
  return rows.map((row) => row.payload as AuditPayload);
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

  // ── Seed: the acting admin, an Ops user, a driver with a user account, ──
  // a port, and a live trip whose container lifts at that port.
  const [adminRow] = await sql`insert into users (username, email, full_name, password_hash, role)
    values ('port-admin', 'admin@test.vn', 'Quản Trị Cảng', 'x', 'ADMIN') returning id`;
  adminUserId = adminRow.id;
  const [opsRow] = await sql`insert into users (username, email, full_name, password_hash, role)
    values ('ops-user', 'ops@test.vn', 'Ops Theo Cảng', 'x', 'OPS') returning id`;
  opsUserId = opsRow.id;
  const [driverUserRow] = await sql`insert into users (username, email, full_name, password_hash, role)
    values ('driver-user', 'driver@test.vn', 'Lái Xe Chuyến 1', 'x', 'DRIVER') returning id`;
  driverUserId = driverUserRow.id;
  const [driverRow] = await sql`insert into drivers (name, phone, user_id) values ('Lái Xe Chuyến 1', '0900000001', ${driverUserId}) returning id`;
  driverId = driverRow.id;
  const [portRow] = await sql`
    insert into ports (name, code, address, short_name, updated_at)
    values ('Cảng Tân Vũ', 'VNTV', 'Bạch Đằng, Hải Phòng', 'Tân Vũ', now())
    returning id`;
  portId = portRow.id;
  const [customer] = await sql`insert into customers (name) values ('Khách cảng Tân Vũ') returning id`;
  const [route] = await sql`insert into routes (name) values ('Tuyến audit cảng') returning id`;
  const [shipment] = await sql`
    insert into shipments (customer_id, cargo_mode, shipment_code, status, created_by)
    values (${customer.id}, 'FCL', 'PORT-AUDIT-1', 'PENDING_DATE', ${adminUserId})
    returning id`;
  const [container] = await sql`
    insert into shipment_containers (shipment_id, container_number, pickup_port_id, updated_at)
    values (${shipment.id}, 'TCNU5789751', ${portId}, now())
    returning id`;
  const [trip] = await sql`
    insert into trips (trip_code, version, customer_id, route_id, departure_date, status, driver_id, shipment_id)
    values ('TRP-PORT-AUDIT-1', 1, ${customer.id}, ${route.id}, '2026-11-26', 'CREATED', ${driverId}, ${shipment.id})
    returning id`;
  await sql`
    insert into trip_containers (trip_id, source_shipment_id, source_shipment_container_id, container_number)
    values (${trip.id}, ${shipment.id}, ${container.id}, 'TCNU5789751')`;

  // ── Real route stack: stub auth → audit middleware → catalog crud router ──
  // Static imports cannot work here: db/config read DATABASE_URL at module
  // init, so every db-touching module must load only after the env points at
  // the throwaway database (same harness law as cus-write-audit-field-diff).
  const { auditLogMiddleware } = await import('../middleware/audit');
  const { default: catalogCrudRouter } = await import('../routes/config/catalog-crud.routes');

  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { user?: AuthUser }).user = {
      userId: adminUserId,
      username: 'port-admin',
      email: 'admin@test.vn',
      fullName: 'Quản Trị Cảng',
      role: Role.ADMIN,
    };
    next();
  });
  app.use(auditLogMiddleware);
  app.use('/api', catalogCrudRouter);
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
  // The crud PUT calls cacheInvalidate, which opens the lazy redis client —
  // close it so the test process can exit (the run must not hang on the
  // open socket after the results print). Dynamic import for the same
  // DATABASE_URL-before-module-init reason as the stack imports above.
  const { disconnectRedis } = await import('../lib/redis');
  await disconnectRedis().catch(() => {});
  const cleanup = postgres('postgres://postgres:postgres@localhost:5441/postgres');
  await cleanup.unsafe(`DROP DATABASE IF EXISTS ${TMP_DB} WITH (FORCE)`);
  await cleanup.end();
});

describe('Port catalog audit + blast radius (K4.61 / SIL-1046)', () => {
  test('GET /ports/:id/usage counts the referencing trips and containers', async () => {
    const res = await fetch(`${baseUrl}/api/ports/${portId}/usage`);
    if (res.status !== 200) throw new Error(`usage read should succeed: ${res.status} ${await res.text()}`);
    const usage = await res.json() as {
      port: { id: number; name: string };
      containerCount: number;
      tripCount: number;
      activeTrips: number;
      trips: Array<{ tripCode: string; status: string; driverId: number | null }>;
    };
    assert.equal(usage.port.id, portId);
    assert.equal(usage.containerCount, 1);
    assert.equal(usage.tripCount, 1);
    assert.equal(usage.activeTrips, 1);
    assert.equal(usage.trips[0]?.tripCode, 'TRP-PORT-AUDIT-1');
    assert.equal(usage.trips[0]?.driverId, driverId);
  });

  test('the update audit row carries the old value beside the new one', async () => {
    const res = await putPort({
      name: 'Cảng Tân Vũ - Bến 5', code: 'VNTV', address: 'Bạch Đằng, Hải Phòng', shortName: 'Tân Vũ',
    }, await currentPortVersion());
    if (res.status !== 200) throw new Error(`update should succeed: ${res.status} ${await res.text()}`);

    const rows = await portAuditRows();
    const updated = rows.reverse().find((row) => row.event === 'ENTITY_UPDATED');
    assert.ok(updated, 'the PUT must persist an ENTITY_UPDATED audit row');
    // The NEW values stay in the request body (structure unchanged)…
    assert.equal((updated.body as Record<string, unknown>).name, 'Cảng Tân Vũ - Bến 5');
    // …and the OLD value rides the field diff.
    const nameChange = (updated.changes ?? []).find((change) => change.field === 'name');
    assert.ok(nameChange, 'the changed field must appear in the diff');
    assert.equal(nameChange.before, 'Cảng Tân Vũ');
    assert.equal(nameChange.after, 'Cảng Tân Vũ - Bến 5');
    // Unchanged fields must NOT read as edits (the form resends everything).
    assert.equal((updated.changes ?? []).some((change) => change.field === 'code'), false);
  });

  test('an unchanged resubmit writes no phantom field diff', async () => {
    const res = await putPort({
      name: 'Cảng Tân Vũ - Bến 5', code: 'VNTV', address: 'Bạch Đằng, Hải Phòng', shortName: 'Tân Vũ',
    }, await currentPortVersion());
    if (res.status !== 200) throw new Error(`resubmit should succeed: ${res.status} ${await res.text()}`);
    const rows = await portAuditRows();
    const updated = rows.reverse().find((row) => row.event === 'ENTITY_UPDATED');
    assert.ok(updated);
    assert.equal((updated.changes ?? []).length, 0);
  });

  test('a content change notifies the live trip driver and Ops', async () => {
    const res = await putPort({
      name: 'Cảng Tân Vũ - Bến 5', code: 'VNTV', address: 'Số mới, Hải Phòng', shortName: 'Tân Vũ',
    }, await currentPortVersion());
    if (res.status !== 200) throw new Error(`update should succeed: ${res.status} ${await res.text()}`);

    const notes = await sql`
      select user_id, type, title, message, related_entity_type, related_entity_id
      from notifications order by id`;
    assert.ok(notes.length >= 2, `driver + Ops must be notified (got ${notes.length})`);
    // Tests 2 and 3 already wrote notifications (the rename wave); this test
    // reads the LATEST pair — the ones this address change produced.
    const driverNote = [...notes].reverse().find((note) => note.user_id === driverUserId);
    assert.ok(driverNote, `the live trip driver must be notified: ${JSON.stringify(notes)}`);
    assert.equal(driverNote.type, 'SYSTEM_ANNOUNCEMENT');
    assert.equal(driverNote.related_entity_type, 'trip');
    assert.ok(String(driverNote.message).includes('address'), `the message names the changed fields: ${driverNote.message}`);
    const opsNote = [...notes].reverse().find((note) => note.user_id === opsUserId);
    assert.ok(opsNote, 'the Ops role must be notified');
    assert.equal(opsNote.related_entity_type, 'port');
    assert.ok(String(opsNote.message).includes('1 chuyến'), 'the Ops summary counts the live trips');
  });
});

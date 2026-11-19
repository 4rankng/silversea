// Ticket 18/11 Task 1.2 AC — a CUS TEAM member edits or locks a lot on behalf
// of its owner: the audit row must carry actor id + role + name, and the
// field-level old→new diff captured inside the write transaction. The actor
// here is a same-ACTIVE-group teammate (never the lot creator), so the flow
// exercises exactly the "sửa/khóa hộ" transparency the ticket names — and the
// owner's own write must produce the SAME metadata shape (only the actor
// fields differ).
//
// Runs against a throwaway DB (schema-only dump of the dev schema, the
// shipment-children-fk pattern) through the REAL route stack: express +
// auditLogMiddleware + the cus-workspace and core shipments routers, with a
// stub auth layer supplying the acting user.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import express from 'express';
import type { Server } from 'node:http';
import postgres from 'postgres';
import { ApiError } from '../errors';
import { Role, ShipmentDocumentCustody } from '@tingting/shared';
import type { AuthUser } from '../middleware/auth';

const TMP_DB = `cus_audit_diff_test_${Date.now().toString(36)}`;
const TMP_URL = 'postgres://postgres:postgres@localhost:5441/' + TMP_DB;
// Must precede every import of db-touching modules: db/config read this at
// module init (dotenv does not override existing process env), and a static
// import would initialize drizzle against the DEV database before the test
// can point it at the throwaway one — the app modules below are imported
// dynamically inside before() for exactly that reason.
process.env.DATABASE_URL = TMP_URL;

let sql: postgres.Sql;
let app: express.Express;
let server: Server;
let baseUrl: string;

interface SeedUser { id: number; fullName: string; username: string }
let owner: SeedUser;
let teammate: SeedUser;
let shipmentId: number;
/** Second lot: a fresh slate for the inline lot-cell edit cases (SIL-851). */
let inlineLotId: number;
let declarationId: number;
/** Which seeded user the stub auth layer hands to the stack for the next request. */
let actingUser: SeedUser;

async function post(pathname: string, body: Record<string, unknown>, idempotencyKey: string): Promise<Response> {
  return fetch(baseUrl + pathname, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(body),
  });
}

async function put(pathname: string, body: Record<string, unknown>, idempotencyKey: string): Promise<Response> {
  return fetch(baseUrl + pathname, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(body),
  });
}

interface AuditRow {
  user_id: number | null;
  actor_name: string | null;
  // audit_logs.payload stores { event, ...metadata } — metadata keys flattened.
  payload: {
    event?: string;
    path?: string;
    actorId?: number;
    actorRole?: string;
    actorName?: string;
    changes?: Array<{ field: string; before: unknown; after: unknown }>;
    [key: string]: unknown;
  };
}

async function shipmentAuditRows(pathPattern: string): Promise<AuditRow[]> {
  return sql`
    select user_id, actor_name, payload
    from audit_logs
    where entity_type = 'shipments'
      and payload->>'path' like ${pathPattern}
    order by id`;
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

  // ── Seed: a CUS team (owner + same-ACTIVE-group teammate) and their lot ──
  const [ownerRow] = await sql`insert into users (username, email, full_name, password_hash, role)
    values ('lot-owner', 'owner@test.vn', 'Trần Chủ Lô', 'x', 'CUS') returning id, full_name, username`;
  owner = { id: ownerRow.id, fullName: ownerRow.full_name, username: ownerRow.username };
  const [teammateRow] = await sql`insert into users (username, email, full_name, password_hash, role)
    values ('lot-teammate', 'teammate@test.vn', 'Nguyễn Văn Hộ', 'x', 'CUS') returning id, full_name, username`;
  teammate = { id: teammateRow.id, fullName: teammateRow.full_name, username: teammateRow.username };
  const [group] = await sql`insert into cus_groups (name) values ('audit-diff-team') returning id`;
  await sql`insert into cus_group_members (group_id, user_id) values (${group.id}, ${owner.id}), (${group.id}, ${teammate.id})`;
  const [customer] = await sql`insert into customers (name) values ('Khách audit-diff') returning id`;
  const [shipment] = await sql`
    insert into shipments (customer_id, cargo_mode, shipment_code, status, created_by)
    values (${customer.id}, 'FCL', 'AUDIT-DIFF-1', 'PENDING_DATE', ${owner.id})
    returning id`;
  shipmentId = shipment.id;
  // SIL-851 — a second fresh lot carrying one tờ khai, so the inline-cell
  // cases diff against known old values without depending on the custody/lock
  // flows above.
  const [inlineLot] = await sql`
    insert into shipments (customer_id, cargo_mode, shipment_code, status, created_by)
    values (${customer.id}, 'FCL', 'AUDIT-DIFF-2', 'PENDING_DATE', ${owner.id})
    returning id`;
  inlineLotId = inlineLot.id;
  const [declaration] = await sql`
    insert into shipment_declarations (shipment_id, declaration_number, scope, created_by)
    values (${inlineLot.id}, 'TK-CU-001', 'SINGLE', ${owner.id})
    returning id`;
  declarationId = declaration.id;

  // ── Real route stack: stub auth → audit middleware → shipments routers ──
  const { auditLogMiddleware } = await import('../middleware/audit');
  const { cusWorkspaceRoutes } = await import('../routes/shipments/cus-workspace.routes');
  const { coreRoutes } = await import('../routes/shipments/core.routes');
  const { documentsRoutes } = await import('../routes/shipments/documents.routes');

  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const actor = actingUser;
    (req as express.Request & { user?: AuthUser }).user = {
      userId: actor.id,
      username: actor.username,
      email: `${actor.username}@test.vn`,
      fullName: actor.fullName,
      role: Role.CUS,
    };
    next();
  });
  app.use(auditLogMiddleware);
  app.use('/api/shipments', cusWorkspaceRoutes);
  app.use('/api/shipments', coreRoutes);
  app.use('/api/shipments', documentsRoutes);
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

describe('CUS-on-behalf audit field diff (ticket 18/11 Task 1.2)', () => {
  test('teammate custody write records actor id + old→new diff, same shape as an owner write', async () => {
    actingUser = teammate;
    const first = await post(`/api/shipments/cus-workspace/${shipmentId}/document-custody`, {
      expectedShipmentVersion: 1,
      status: ShipmentDocumentCustody.SUBMITTED_TO_ACCOUNTING,
      note: 'nộp hộ chủ lô',
    }, 'audit-diff-custody-1');
    assert.equal(first.status, 201, `custody write should succeed: ${await first.text()}`);

    const [teammateAudit] = await shipmentAuditRows('%/cus-workspace/' + shipmentId + '/document-custody');
    assert.ok(teammateAudit, 'custody write must persist an audit row');
    // WHO acted: actor user id on the column AND role/name riding the metadata.
    assert.equal(teammateAudit.user_id, teammate.id);
    assert.equal(teammateAudit.actor_name, teammate.fullName);
    assert.equal(teammateAudit.payload.actorId, teammate.id);
    assert.equal(teammateAudit.payload.actorRole, Role.CUS);
    assert.equal(teammateAudit.payload.actorName, teammate.fullName);
    // WHAT changed: field-level old→new captured inside the write transaction.
    assert.deepEqual(teammateAudit.payload.changes, [
      { field: 'documentCustodyStatus', before: null, after: ShipmentDocumentCustody.SUBMITTED_TO_ACCOUNTING },
      { field: 'documentCustodyNote', before: null, after: 'nộp hộ chủ lô' },
    ]);

    // The OWNER's own write has the same metadata SHAPE — only the actor fields differ.
    actingUser = owner;
    const second = await post(`/api/shipments/cus-workspace/${shipmentId}/document-custody`, {
      expectedShipmentVersion: 2,
      status: ShipmentDocumentCustody.OPS_HOLDING,
    }, 'audit-diff-custody-2');
    assert.equal(second.status, 201, `owner custody write should succeed: ${await second.text()}`);

    const ownerRows = await shipmentAuditRows('%/cus-workspace/' + shipmentId + '/document-custody');
    const ownerAudit = ownerRows[1];
    assert.ok(ownerAudit, 'owner write must persist its own audit row');
    assert.equal(ownerAudit.user_id, owner.id);
    assert.deepEqual(Object.keys(ownerAudit.payload.metadata ?? {}).sort(), Object.keys(teammateAudit.payload.metadata ?? {}).sort());
    assert.deepEqual(ownerAudit.payload.changes, [
      { field: 'documentCustodyStatus', before: ShipmentDocumentCustody.SUBMITTED_TO_ACCOUNTING, after: ShipmentDocumentCustody.OPS_HOLDING },
      { field: 'documentCustodyNote', before: 'nộp hộ chủ lô', after: null },
    ]);
  });

  test('cost lock on behalf of the owner records costLock old→new + actor id', async () => {
    actingUser = teammate;
    const response = await post(`/api/shipments/${shipmentId}/lock`, {
      lockNote: 'khóa hộ chủ lô',
    }, 'audit-diff-cost-lock-1');
    assert.ok(response.status === 201 || response.status === 200, `cost lock should succeed: ${await response.text()}`);

    const [lockRow] = await sql`select locked_by, lock_note from shipment_cost_locks where shipment_id = ${shipmentId}`;
    assert.ok(lockRow, 'cost lock row must exist');
    assert.equal(lockRow.locked_by, teammate.id, 'the lock row names the TEAMMATE as locker');
    assert.equal(lockRow.lock_note, 'khóa hộ chủ lô');

    const [auditRow] = await shipmentAuditRows('%/api/shipments/' + shipmentId + '/lock');
    assert.ok(auditRow, 'cost lock must persist an audit row');
    assert.equal(auditRow.user_id, teammate.id);
    assert.equal(auditRow.payload.actorRole, Role.CUS);
    assert.equal(auditRow.payload.actorId, teammate.id);
    assert.deepEqual(auditRow.payload.changes, [
      { field: 'costLock', before: false, after: true },
    ]);
  });

  // SIL-851 — the inline lot-cell editors that ride PUT /:id (ghi chú,
  // chứng từ, identity LCL, lịch trình) must leave the same field-level
  // old→new audit trail as the workspace writes, when a TEAMMATE acts.
  test('teammate inline lot-cell edit via PUT /:id records field-level old→new + actor id', async () => {
    actingUser = teammate;
    const response = await put(`/api/shipments/${inlineLotId}`, {
      expectedVersion: 1,
      customerNotes: 'Ghi chú hộ chủ lô từ teammate',
      blNumber: 'BL-TEAM-001',
    }, 'audit-diff-inline-put-1');
    assert.equal(response.status, 200, `inline PUT should succeed: ${await response.text()}`);

    const [auditRow] = await shipmentAuditRows('%/api/shipments/' + inlineLotId);
    assert.ok(auditRow, 'inline cell edit must persist an audit row');
    // WHO acted on the teammate's behalf-write.
    assert.equal(auditRow.user_id, teammate.id);
    assert.equal(auditRow.payload.actorId, teammate.id);
    assert.equal(auditRow.payload.actorRole, Role.CUS);
    assert.equal(auditRow.payload.actorName, teammate.fullName);
    // WHAT changed: both edits were null on the fresh lot — old→new per field.
    assert.deepEqual(auditRow.payload.changes, [
      { field: 'blNumber', before: null, after: 'BL-TEAM-001' },
      { field: 'customerNotes', before: null, after: 'Ghi chú hộ chủ lô từ teammate' },
    ]);
  });

  test('teammate tờ khai edit records declaration old→new + actor id', async () => {
    actingUser = teammate;
    const response = await put(`/api/shipments/${inlineLotId}/declarations/${declarationId}`, {
      declarationNumber: 'TK-MOI-002',
      scope: 'SINGLE',
    }, 'audit-diff-declaration-put-1');
    assert.equal(response.status, 200, `declaration PUT should succeed: ${await response.text()}`);

    const [auditRow] = await shipmentAuditRows('%/api/shipments/' + inlineLotId + '/declarations/' + declarationId);
    assert.ok(auditRow, 'declaration edit must persist an audit row');
    assert.equal(auditRow.user_id, teammate.id);
    assert.equal(auditRow.payload.actorId, teammate.id);
    assert.deepEqual(auditRow.payload.changes, [
      { field: `declaration.${declarationId}.declarationNumber`, before: 'TK-CU-001', after: 'TK-MOI-002' },
    ]);
  });
});

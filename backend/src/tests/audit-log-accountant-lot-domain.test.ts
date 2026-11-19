// SIL-851 — /audit-logs (Nhật ký người dùng) as Kế toán (hoapt, ACCOUNTANT)
// must show the LOT-domain audit rows: a teammate's lot edit persists
// SHIPMENT_UPDATED with field old→new (bdbe646e), but queryAuditLogs scoped
// the ACCOUNTANT viewer to the FINANCE domain only, so those rows never
// reached the page — QA searched 'R3P-677-R'/'tiepvv' and got 0 events while
// the table held 21k rows. The lot domain (shipments + cus-workspace writes)
// now passes unconditionally for the accountant (their lot surfaces are not
// customer-link scoped); the finance domain keeps its assignment scoping and
// out-of-domain rows (trips) stay hidden.
//
// Runs against a throwaway DB (schema-only dump of the dev schema, the
// shipment-children-fk pattern) and calls queryAuditLogs directly.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import postgres from 'postgres';
import { Role } from '@tingting/shared';
// Type-only import — erased at runtime, so it does NOT initialize the db
// module before DATABASE_URL points at the throwaway DB (the dynamic import
// in before() is the runtime seam; see cus-write-audit-field-diff.test.ts).
import type { queryAuditLogs as queryAuditLogsFn } from '../services/audit-query.service';

const TMP_DB = `audit_lot_domain_test_${Date.now().toString(36)}`;
const TMP_URL = 'postgres://postgres:postgres@localhost:5441/' + TMP_DB;
// Must precede every import of db-touching modules (see
// cus-write-audit-field-diff.test.ts) — app modules import dynamically in before().
process.env.DATABASE_URL = TMP_URL;

let sql: postgres.Sql;
// Runtime dynamic import is deliberate: the audit-query service pulls the
// drizzle db singleton, which reads DATABASE_URL at module init — a static
// import would bind it to the dev DB before this file can retarget it.
let queryAuditLogs: typeof queryAuditLogsFn;

// Module-level viewer consts read this before before() runs — an initializer
// keeps the definite-assignment analysis clean; before() overwrites it.
let accountantId = 0;
let teammateId: number;
let customerId: number;

async function seedAuditRow(row: {
  userId: number | null;
  actorName: string;
  entityType: string;
  entityId: number | null;
  message: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  // The payload object is passed AS AN OBJECT: postgres-js serializes it with
  // the jsonb column type, so `payload->'changes'` stays a real array. A
  // pre-stringified `${JSON.stringify(...)}::jsonb` would be re-encoded as a
  // jsonb STRING and every ->'changes' lookup would silently miss.
  await sql`
    insert into audit_logs (user_id, actor_name, entity_type, entity_id, message, payload)
    values (${row.userId}, ${row.actorName}, ${row.entityType}, ${row.entityId}, ${row.message}, ${row.payload as never})`;
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

  const [accountant] = await sql`insert into users (username, email, full_name, password_hash, role)
    values ('ketoan-audit', 'ketoan@test.vn', 'Phạm Kế Toán', 'x', 'ACCOUNTANT') returning id`;
  accountantId = accountant.id;
  const [teammate] = await sql`insert into users (username, email, full_name, password_hash, role)
    values ('tiepvv-audit', 'tiep@test.vn', 'Vũ Văn Tiệp', 'x', 'CUS') returning id`;
  teammateId = teammate.id;
  const [customer] = await sql`insert into customers (name) values ('Khách audit-lot-domain') returning id`;
  customerId = customer.id;
  // Deliberately NO user_customer_links for the accountant: lot-domain rows
  // must NOT depend on assignment bookkeeping (the defect this pins).

  // The exact shape staging held for the QA repro (audit_logs id 21089).
  await seedAuditRow({
    userId: teammateId,
    actorName: 'Vũ Văn Tiệp',
    entityType: 'shipments',
    entityId: 806,
    message: 'Chứng từ Vũ Văn Tiệp đã cập nhật thông tin lô hàng SHP-2611-00312',
    payload: {
      event: 'SHIPMENT_UPDATED',
      path: '/api/shipments/806',
      method: 'PUT',
      statusCode: 200,
      outcome: 'SUCCEEDED',
      actorId: teammateId,
      actorRole: Role.CUS,
      actorName: 'Vũ Văn Tiệp',
      changes: [{ field: 'blNumber', before: 'R3P-677-R-QA2', after: 'R3P-677-R' }],
      body: { customerId: customerId, blNumber: 'R3P-677-R' },
    },
  });
  // CUS-workspace write on the same lot — visible via the path prefix arm.
  await seedAuditRow({
    userId: teammateId,
    actorName: 'Vũ Văn Tiệp',
    entityType: 'cus-workspace',
    entityId: 806,
    message: 'Nguyễn Văn Hộ cập nhật chứng từ đếm container',
    payload: {
      event: 'ENTITY_UPDATED',
      path: '/api/cus-workspace/806/document-custody',
      method: 'PUT',
      statusCode: 200,
      outcome: 'SUCCEEDED',
      actorId: teammateId,
      actorRole: Role.CUS,
      changes: [{ field: 'status', before: 'OPS_HOLDING', after: 'CUS_RECEIVED' }],
    },
  });
  // Finance domain, not customer-bound → accountant still sees it.
  await seedAuditRow({
    userId: accountantId,
    actorName: 'Phạm Kế Toán',
    entityType: 'advances',
    entityId: 7,
    message: 'Tạo mới quyết toán tạm ứng: phiếu hoàn ứng PT-2611-0007',
    payload: { event: 'ENTITY_UPDATED', path: '/api/advances/7', statusCode: 200, outcome: 'SUCCEEDED' },
  });
  // Customer-bound finance row for a customer the accountant is NOT linked
  // to → must stay hidden (finance assignment scoping preserved).
  await seedAuditRow({
    userId: teammateId,
    actorName: 'Vũ Văn Tiệp',
    entityType: 'payments',
    entityId: 9,
    message: 'Khách trả tiền hàng unassigned-payment',
    payload: {
      event: 'PAYMENT_RECEIVED',
      path: '/api/payments/receive',
      statusCode: 200,
      outcome: 'SUCCEEDED',
      body: { customerId: customerId },
    },
  });
  // Trip domain → outside both the finance and lot domains → hidden.
  await seedAuditRow({
    userId: teammateId,
    actorName: 'Vũ Văn Tiệp',
    entityType: 'trips',
    entityId: 12,
    message: 'Chuyến xe out-of-domain-trip hoàn tất',
    payload: { event: 'TRIP_COMPLETED', path: '/api/trips/12/complete', statusCode: 200, outcome: 'SUCCEEDED' },
  });

  ({ queryAuditLogs } = await import('../services/audit-query.service'));
});

after(async () => {
  await sql?.end();
  const admin = postgres('postgres://postgres:postgres@localhost:5441/postgres');
  // WITH (FORCE): the imported service's drizzle pool still holds sockets —
  // same teardown as cus-write-audit-field-diff.test.ts.
  await admin.unsafe(`DROP DATABASE IF EXISTS ${TMP_DB} WITH (FORCE)`);
  await admin.end();
});

const accountantViewer = { userId: accountantId, role: Role.ACCOUNTANT };
const adminViewer = { userId: accountantId, role: Role.ADMIN };

async function messages(viewer: { userId: number; role: Role }, search?: string): Promise<string[]> {
  const page = await queryAuditLogs({ page: 1, limit: 50, viewer, search });
  return page.items.map((item) => item.message);
}

describe('audit-logs ACCOUNTANT sees the lot domain (SIL-851)', () => {
  test('unscoped list includes the teammate lot edit + cus-workspace rows, keeps trips out', async () => {
    const rows = await messages(accountantViewer);
    assert.ok(rows.some((m) => m.includes('SHP-2611-00312')), `lot edit row must be listed: ${JSON.stringify(rows)}`);
    assert.ok(rows.some((m) => m.includes('chứng từ đếm container')), 'cus-workspace row must be listed');
    assert.ok(rows.some((m) => m.includes('PT-2611-0007')), 'finance row must stay listed');
    assert.ok(!rows.some((m) => m.includes('out-of-domain-trip')), 'trip row must stay hidden');
    assert.ok(!rows.some((m) => m.includes('unassigned-payment')), 'unassigned customer-bound finance row must stay hidden');
  });

  test("search by the changed field's old→new value finds the lot edit (QA searched 'R3P-677-R')", async () => {
    const rows = await messages(accountantViewer, 'R3P-677-R');
    assert.equal(rows.length, 1);
    assert.match(rows[0]!, /SHP-2611-00312/);
  });

  test("search by the actor's username finds the lot edits (QA searched 'tiepvv')", async () => {
    const rows = await messages(accountantViewer, 'tiepvv-audit');
    assert.ok(rows.some((m) => m.includes('SHP-2611-00312')), `lot edit row must be found: ${JSON.stringify(rows)}`);
    assert.ok(rows.some((m) => m.includes('chứng từ đếm container')), 'custody row by the same actor is found too');
    assert.ok(!rows.some((m) => m.includes('out-of-domain-trip')), 'hidden domains stay out of search results');
  });

  test('the returned category of a lot row is trip — tabs stay a partition (QA round 4 saw 0 in both tabs)', async () => {
    const page = await queryAuditLogs({ page: 1, limit: 50, viewer: accountantViewer, search: 'SHP-2611-00312' });
    assert.equal(page.items[0]?.category, 'trip');
    const tripPage = await queryAuditLogs({ page: 1, limit: 50, viewer: accountantViewer, category: 'trip' });
    assert.ok(tripPage.items.some((i) => i.message.includes('SHP-2611-00312')), "'Chuyến đi' tab surfaces the lot edit row");
    const financePage = await queryAuditLogs({ page: 1, limit: 50, viewer: accountantViewer, category: 'finance' });
    assert.ok(financePage.items.some((i) => i.message.includes('PT-2611-0007')), 'finance tab keeps its rows');
    assert.ok(!financePage.items.some((i) => i.message.includes('SHP-2611-00312')), 'lot rows do not leak into the finance tab');
  });

  // The AC names the changed field + old→new — the accountant response must
  // keep them (payload unredacted + method/path visible), while finance rows
  // keep the slim redaction shape.
  test('lot-domain rows keep changes old→new + actor + path for the accountant; finance stays redacted', async () => {
    const page = await queryAuditLogs({ page: 1, limit: 50, viewer: accountantViewer, search: 'SHP-2611-00312' });
    const lotRow = page.items[0]!;
    assert.equal(lotRow.path, '/api/shipments/806');
    assert.equal(lotRow.method, 'PUT');
    const payload = lotRow.payload as Record<string, unknown>;
    assert.deepEqual(payload['changes'], [{ field: 'blNumber', before: 'R3P-677-R-QA2', after: 'R3P-677-R' }]);
    assert.equal(payload['actorName'], 'Vũ Văn Tiệp');
    assert.equal(payload['actorRole'], Role.CUS);

    const financePage = await queryAuditLogs({ page: 1, limit: 50, viewer: accountantViewer, search: 'PT-2611-0007' });
    const financeRow = financePage.items[0]!;
    assert.deepEqual(
      Object.keys(financeRow.payload ?? {}).sort(),
      ['event', 'failed', 'idempotencyKeyPresent', 'outcome', 'statusCode'],
      'finance payload keeps the redaction shape',
    );
    assert.equal(financeRow.path, '', 'finance row path stays accountant-hidden');
  });

  test('ADMIN viewer is unchanged — sees every domain', async () => {
    const rows = await messages(adminViewer);
    assert.ok(rows.some((m) => m.includes('SHP-2611-00312')));
    assert.ok(rows.some((m) => m.includes('out-of-domain-trip')));
    assert.ok(rows.some((m) => m.includes('unassigned-payment')));
  });
});

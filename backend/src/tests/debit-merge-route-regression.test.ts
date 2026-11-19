// SIL-814/820/821/837/847 — endpoint-level regression gate for the board-wide
// 500 on GET /api/accounting/debit-merge. The crash shape QA hit on staging
// (builds ad4f0597/4db2d62f, fixed in d5367703): ONE lot priced by an
// ops-charge / freight / PS side with NO trip_expense rows —
// receivableDetermined arms on any one side, and ab50b4c9's rollup deref'd
// `revenue!.otherSell` on `revenue === undefined` → TypeError → HTTP 500 for
// EVERY role, /shipments-debit showing "Không thể tải danh sách quyết toán".
// The route must return 200 WITH data: the armed lot's Tổng TC = its known
// sides (revenue sides contribute 0 — the shipment-debit-summary law), and an
// unarmed lot's Tổng TC stays null (không bịa 0 — luật 24/10).
// Harness: throwaway schema-only DB (the shipment-children-fk pattern) behind
// the REAL accounting-debit router with a stub auth layer (no HTTP harness
// exists beyond this pattern; casbinAuthz lives on the index.ts mount, not in
// the router).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import express from 'express';
import type { Server } from 'node:http';
import postgres from 'postgres';
import { ApiError } from '../errors';
import { Role } from '@tingting/shared';

const TMP_DB = `debit_merge_route_test_${Date.now().toString(36)}`;
const TMP_URL = 'postgres://postgres:postgres@localhost:5441/' + TMP_DB;
// Must precede every dynamic import of db-touching modules: db/config reads
// this at module init, and a static import would bind drizzle to the DEV
// database before the test can point it at the throwaway one.
process.env.DATABASE_URL = TMP_URL;

let sql: postgres.Sql;
let app: express.Express;
let server: Server;
let baseUrl: string;
let lotArmedCode: string;
let lotBlankCode: string;

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

  // ── Seed the crash shape: lot ARMED has a negotiated ops customer charge
  // (opsChargeKnownTotal ≠ 0 → receivableDetermined arms) and NO trips /
  // trip_expenses rows anywhere, so the rollup reaches Tổng TC with
  // `revenue === undefined`. lot BLANK has no determined side at all. ──
  const [customer] = await sql`insert into customers (name) values ('Khách debit-merge route') returning id`;
  const [armed] = await sql`
    insert into shipments (customer_id, cargo_mode, shipment_code, status, created_by)
    values (${customer.id}, 'FCL', 'DMRT-ARMED-1', 'PENDING_DATE', null)
    returning id, shipment_code`;
  const [blank] = await sql`
    insert into shipments (customer_id, cargo_mode, shipment_code, status, created_by)
    values (${customer.id}, 'FCL', 'DMRT-BLANK-2', 'PENDING_DATE', null)
    returning id, shipment_code`;
  lotArmedCode = armed.shipment_code;
  lotBlankCode = blank.shipment_code;
  await sql`
    insert into ops_expense_entries
      (shipment_id, expense_type_code, amount, paid_at, customer_charge_amount, fee_name)
    values (${armed.id}, 'LIFT_CHARGE', 300000, '2026-11-19', 500000, 'Phí nâng container')`;

  // ── Real route stack: stub auth (Kế toán) → accounting-debit router ──
  // Dynamic import is REQUIRED here (shipment-children-fk pattern): the router
  // transitively imports db, whose drizzle client binds DATABASE_URL at module
  // init — a static import would bind the DEV database before before() points
  // the env at the throwaway one above.
  const { default: accountingDebitRoutes } = await import('../routes/accounting-debit');

  app = express();
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
  if (sql) await sql.end();
  const cleanup = postgres('postgres://postgres:postgres@localhost:5441/postgres');
  await cleanup.unsafe(`DROP DATABASE IF EXISTS ${TMP_DB} WITH (FORCE)`);
  await cleanup.end();
});

interface DebitMergeBoardItem {
  code: string;
  revenue: { phatSinh: string | null };
  control: { tongTc: string | null; lockStatus: 'LOCKED' | 'OPEN' };
}

describe('GET /api/accounting/debit-merge — board renders with revenue-less priced lots (SIL-814 route gate)', () => {
  test('REGRESSION: HTTP 200 + dữ liệu — lô arm qua phí ops KHÔNG trip_expenses không còn 500 cả board', async () => {
    const res = await fetch(baseUrl + '/api/accounting/debit-merge');
    assert.equal(res.status, 200, 'board must not 500 on a priced lot without trip_expense rows');
    const body = (await res.json()) as { total: number; items: DebitMergeBoardItem[] };
    assert.equal(body.total, 2, 'both seeded lots must come back');
    assert.equal(body.items.length, 2);

    const armed = body.items.find((item) => item.code === lotArmedCode);
    assert.ok(armed, 'armed lot must render');
    // Tổng TC = the known ops charge; revenue sides contribute 0 (summary law).
    assert.equal(armed.control.tongTc, '500000');
    assert.equal(armed.control.lockStatus, 'OPEN');
    // Phát sinh (revenue side) stays null — no rows, no fabricated '0'.
    assert.equal(armed.revenue.phatSinh, null);

    const blank = body.items.find((item) => item.code === lotBlankCode);
    assert.ok(blank, 'unarmed lot must render');
    // No determined side → Tổng TC null (không bịa 0 — luật 24/10).
    assert.equal(blank.control.tongTc, null);
  });
});

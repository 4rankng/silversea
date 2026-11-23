// Endpoint-level regression gate for the fake '0' on /shipments-debit
// (QA 19/11, staging build ee463c34, lot R3K-J1 SHP-2611-00244). The staging
// shape: an OPEN, FCL, non-merged lot whose only money is kế toán's saved
// per-cell override cuoc_thu = 0 (freight channel resolves null — the
// all-zero intake freeze is not a price). The board must render the CƯỚC and
// TỔNG cells BLANK (luật 24/10: a 0 renders only as a computed component of
// a determined rollup or on a merge member) — the saved override 0 does not
// price the lot. A non-zero override still prices the cell.
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

const TMP_DB = `debit_override_zero_test_${Date.now().toString(36)}`;
const TMP_URL = 'postgres://postgres:postgres@localhost:5441/' + TMP_DB;
// Must precede every dynamic import of db-touching modules (db/config reads
// this at module init).
process.env.DATABASE_URL = TMP_URL;

let sql: postgres.Sql;
let server: Server;
let baseUrl: string;
let lotFakeZeroCode: string;
let lotPricedCode: string;

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

  // ── Seed the staging shape. LOT-FAKE: freight freeze that carries no price
  // (all-zero reference ids — the intake zero the grain query skips) + a
  // saved cuoc_thu = 0 override. LOT-PRICED: same freight-less lot, but the
  // override prices it for real (3.950.000) — the deliberate-pricing flow
  // must keep working. ──
  const [customer] = await sql`insert into customers (name) values ('Khách override-zero') returning id`;
  const [fakeZero] = await sql`
    insert into shipments (customer_id, cargo_mode, shipment_code, status, created_by)
    values (${customer.id}, 'FCL', 'DOZ-FAKE-1', 'DISPATCHED', null)
    returning id, shipment_code`;
  const [priced] = await sql`
    insert into shipments (customer_id, cargo_mode, shipment_code, status, created_by)
    values (${customer.id}, 'FCL', 'DOZ-PRICED-2', 'DISPATCHED', null)
    returning id, shipment_code`;
  lotFakeZeroCode = fakeZero.shipment_code;
  lotPricedCode = priced.shipment_code;
  await sql`
    insert into freight_rate_snapshots (shipment_id, trip_id, freight_amount, surcharge_amount, total_amount, rate_terms_id, pricing_table_id, fuel_norm_id, fuel_price_period_id, billed_km, liters, fuel_delta, share_pct)
    values (${fakeZero.id}, null, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1)`;
  await sql`
    insert into shipment_debit_rate_overrides (shipment_id, cuoc_thu, updated_by)
    values (${fakeZero.id}, 0, 1)`;
  await sql`
    insert into shipment_debit_rate_overrides (shipment_id, cuoc_thu, updated_by)
    values (${priced.id}, 3950000, 1)`;

  const { default: accountingDebitRoutes } = await import('../routes/accounting-debit');
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
  if (sql) await sql.end();
  const cleanup = postgres('postgres://postgres:postgres@localhost:5441/postgres');
  await cleanup.unsafe(`DROP DATABASE IF EXISTS ${TMP_DB} WITH (FORCE)`);
  await cleanup.end();
});

interface MergeItem {
  code: string;
  revenue: { cuoc: string | null; tong: string | null };
  control: { tongTc: string | null; lockStatus: 'LOCKED' | 'OPEN' };
}

describe('GET /api/accounting/debit-merge — override 0 không định giá lô chưa có giá (luật 24/10)', () => {
  test('REGRESSION: ô CƯỚC/TỔNG của lô chỉ có override 0 là TRỐNG; override ≠ 0 vẫn định giá', async () => {
    const res = await fetch(baseUrl + '/api/accounting/debit-merge');
    assert.equal(res.status, 200);
    const body = (await res.json()) as { total: number; items: MergeItem[] };

    const fakeZero = body.items.find((item) => item.code === lotFakeZeroCode);
    assert.ok(fakeZero, 'override-zero lot must render');
    assert.equal(fakeZero.revenue.cuoc, null, 'saved 0 does not price an unpriced lot — ô TRỐNG');
    assert.equal(fakeZero.revenue.tong, null, 'no fabricated total — không bịa 0');
    assert.equal(fakeZero.control.tongTc, null, 'rollup stays undetermined');
    assert.equal(fakeZero.control.lockStatus, 'OPEN');

    const pricedLot = body.items.find((item) => item.code === lotPricedCode);
    assert.ok(pricedLot, 'priced lot must render');
    assert.equal(pricedLot.revenue.cuoc, '3950000', 'a real override price still applies');
    assert.equal(pricedLot.revenue.tong, '3950000');
    // SIL-855 QA 23/11 (round 5) — Tổng TC reads the SAME merged cell: a lot
    // priced ONLY by the SIL-805 override (no bảng giá row) must arm
    // control.tongTc with that money instead of showing revenue full while
    // the control figure stays null (the exact R3P-677-C desync that let a
    // half-money note exist).
    assert.equal(pricedLot.control.tongTc, '3950000', 'Tổng TC syncs with doanh thu khi nhập cước');
    assert.equal(pricedLot.control.lockStatus, 'OPEN');
  });
});

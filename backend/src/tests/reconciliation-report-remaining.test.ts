// Endpoint-level regression gate for the Báo cáo hoàn ứng "Còn phải hoàn ứng"
// column (QA 19/11, staging build ee463c34). The exact staging shape: staff
// whose advance requests are FULLY settled by the legacy phiếu family — the
// signed wallet (`outstandingSigned`) reads 0, while the report's own columns
// show ĐÃ ỨNG (recorded gross) 320.000 and ĐNTT 45.000. The column must be
// the DIFFERENCE of its two adjacent columns (khớp 100% Quỹ cá nhân Số dư
// quỹ by construction), signed per the CTO law: (+) cá nhân hoàn lại, (−)
// công ty trả thêm — never the wallet 0.
// Harness: throwaway schema-only DB behind the REAL expense-accounting cash
// router with a stub auth layer (debit-merge-route-regression pattern).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import express from 'express';
import type { Server } from 'node:http';
import postgres from 'postgres';
import { ApiError } from '../errors';
import { Role } from '@tingting/shared';

const TMP_DB = `recon_report_test_${Date.now().toString(36)}`;
const TMP_URL = 'postgres://postgres:postgres@localhost:5441/' + TMP_DB;
// Must precede every dynamic import of db-touching modules (db/config reads
// this at module init).
process.env.DATABASE_URL = TMP_URL;

let sql: postgres.Sql;
let server: Server;
let baseUrl: string;
let staffAId: number;
let staffBId: number;

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

  // ── Seed the QA shape. Staff A: advance 320.000 recorded in-window, fully
  // consumed by a legacy settlement phiếu (wallet → 0), confirmed ĐNTT
  // 45.000 → the column must read +275.000. Staff B: advance 100.000,
  // confirmed ĐNTT 300.000 → the column must read −200.000 (công ty trả
  // thêm), never clamped. ──
  const [customer] = await sql`insert into customers (name) values ('Khách báo cáo hoàn ứng') returning id`;
  const [lot] = await sql`
    insert into shipments (customer_id, cargo_mode, shipment_code, status, created_by)
    values (${customer.id}, 'FCL', 'RRT-LOT-1', 'PENDING_DATE', null) returning id`;
  const [staffA] = await sql`
    insert into users (username, full_name, role, password_hash)
    values ('nva', 'Nhân Viên A', 'OPS', 'x') returning id`;
  const [staffB] = await sql`
    insert into users (username, full_name, role, password_hash)
    values ('nvb', 'Nhân Viên B', 'OPS', 'x') returning id`;
  staffAId = staffA.id;
  staffBId = staffB.id;
  await sql`
    insert into advance_requests (requester_id, amount, reason, status, approved_at, requester_name_snapshot)
    values (${staffA.id}, 320000, 'Tạm ứng chi phícont', 'RECORDED', '2026-11-05 10:00', 'Nhân Viên A')`;
  await sql`
    insert into advance_requests (requester_id, amount, reason, status, approved_at, requester_name_snapshot)
    values (${staffB.id}, 100000, 'Tạm ứng phí kiểm hóa', 'RECORDED', '2026-11-06 10:00', 'Nhân Viên B')`;
  // The QA discriminator: the staff's signed WALLET authority reads 0 for an
  // advance never funded (min(granted, funded) = 0) — staging reached the
  // same 0 through funding-then-full-settlement. The report column must be
  // the difference of its own two columns, not this wallet number.
  // Confirmed ĐNTT per staff (expense_accounting_sources.confirmed_at NOT NULL).
  const [expA] = await sql`
    insert into ops_expense_entries (shipment_id, expense_type_code, amount, paid_by_id, paid_at, approval_status, fee_name)
    values (${lot.id}, 'LIFT_CHARGE', 45000, ${staffA.id}, '2026-11-08', 'RECORDED', 'Phí nâng') returning id`;
  const [expB] = await sql`
    insert into ops_expense_entries (shipment_id, expense_type_code, amount, paid_by_id, paid_at, approval_status, fee_name)
    values (${lot.id}, 'LIFT_CHARGE', 300000, ${staffB.id}, '2026-11-09', 'RECORDED', 'Phí kiểm hóa') returning id`;
  await sql`
    insert into expense_accounting_sources (source_kind, source_id, shipment_id, confirmed_at, status)
    values ('OPS', ${expA.id}, ${lot.id}, now(), 'CONFIRMED')`;
  await sql`
    insert into expense_accounting_sources (source_kind, source_id, shipment_id, confirmed_at, status)
    values ('OPS', ${expB.id}, ${lot.id}, now(), 'CONFIRMED')`;

  // Dynamic import is REQUIRED (not stylistic): the cash router transitively
  // imports db, whose drizzle client binds DATABASE_URL at module init — a
  // static import would bind the DEV database before the before() above
  // points the env at the throwaway one (debit-merge-route-regression
  // pattern).
  const { default: cashRoutes } = await import('../routes/expense-accounting-cash');
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
  app.use('/api/expense-accounting', cashRoutes);
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

interface ReportRow {
  staffId: number;
  staffName: string;
  dntt: number;
  advanced: number;
  advancedRecorded: number;
  remaining: number;
  remainingSigned: number;
  outstandingSigned: number;
  needsCollection: boolean;
  direction: string;
  note: string;
}
interface ReportBody {
  rows: ReportRow[];
  totals: { dntt: number; advanced: number; advancedRecorded: number; remaining: number; remainingSigned: number };
}

describe('GET /api/expense-accounting/reconciliation-report — Còn phải hoàn ứng = ĐÃ ỨNG − ĐNTT', () => {
  test('REGRESSION: fully-settled staff reads +275.000 (hiệu 2 cột kề bên), not the wallet 0', async () => {
    const res = await fetch(baseUrl + '/api/expense-accounting/reconciliation-report?from=2026-11-01&to=2026-11-30');
    assert.equal(res.status, 200);
    const body = (await res.json()) as ReportBody;

    const rowA = body.rows.find((row) => row.staffId === staffAId);
    assert.ok(rowA, 'staff A row must render');
    assert.equal(rowA.advancedRecorded, 320000, 'ĐÃ ỨNG reads the recorded gross');
    assert.equal(rowA.dntt, 45000);
    assert.equal(rowA.outstandingSigned, 0, 'wallet authority nets to 0 after the legacy phiếu');
    assert.equal(rowA.remainingSigned, 275000, 'Còn phải hoàn ứng = ĐÃ ỨNG − ĐNTT, khớp Quỹ cá nhân');
    assert.equal(rowA.needsCollection, true, 'dương = cá nhân hoàn lại');
    assert.equal(rowA.note, 'Đề nghị thu tiền ứng');

    const rowB = body.rows.find((row) => row.staffId === staffBId);
    assert.ok(rowB, 'staff B row must render');
    assert.equal(rowB.remainingSigned, -200000, 'âm giữ dấu — công ty trả thêm, không kẹp 0');
    assert.equal(rowB.needsCollection, false);
    assert.equal(rowB.note, 'Công ty trả thêm phần chi vượt ứng');
  });

  test('đối chiếu tổng: totals.remainingSigned = totals.advancedRecorded − totals.dntt = Σ rows', async () => {
    const res = await fetch(baseUrl + '/api/expense-accounting/reconciliation-report?from=2026-11-01&to=2026-11-30');
    assert.equal(res.status, 200);
    const body = (await res.json()) as ReportBody;
    const sumRows = body.rows.reduce((sum, row) => sum + row.remainingSigned, 0);
    assert.equal(body.totals.advancedRecorded, 420000);
    assert.equal(body.totals.dntt, 345000);
    assert.equal(body.totals.remainingSigned, sumRows, 'tổng cột = Σ dòng');
    assert.equal(body.totals.remainingSigned, body.totals.advancedRecorded - body.totals.dntt, 'khớp hiệu 2 tổng hiển thị');
  });
});

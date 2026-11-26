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
let staffCId: number;
let staffDId: number;
let drillLotId: number;

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
  // SIL-1056 — staff C is the staging shape: advance 1.000.000, confirmed
  // ĐNTT 3.479.000 → canonical balance −2.479.000 (công ty chi bù); the
  // chi-bù phiếu PT-2611-0010 (refundAmount −2.479.000) settles it → the
  // canonical authority nets to 0 and the row must read 0đ with no
  // collection affordance — never the gross ghost −2.479.000 the old
  // fallback resurrected.
  const [staffC] = await sql`
    insert into users (username, full_name, role, password_hash)
    values ('nvc', 'Nhân Viên C', 'OPS', 'x') returning id`;
  staffCId = staffC.id;
  await sql`
    insert into advance_requests (requester_id, amount, reason, status, approved_at, requester_name_snapshot)
    values (${staffC.id}, 1000000, 'Tạm ứng chi phí cont', 'RECORDED', '2026-11-07 10:00', 'Nhân Viên C')`;
  await sql`
    insert into advance_settlements (code, forwarder_id, total_expense_amount, refund_amount, status, approved_by, approved_at)
    values ('PT-2611-0010', ${staffC.id}, '3479000', '-2479000', 'RECORDED', ${staffC.id}, '2026-11-20 10:00')`;
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
  const [expC] = await sql`
    insert into ops_expense_entries (shipment_id, expense_type_code, amount, paid_by_id, paid_at, approval_status, fee_name)
    values (${lot.id}, 'LIFT_CHARGE', 3479000, ${staffC.id}, '2026-11-10', 'RECORDED', 'Phí nâng') returning id`;
  await sql`
    insert into expense_accounting_sources (source_kind, source_id, shipment_id, confirmed_at, status)
    values ('OPS', ${expC.id}, ${lot.id}, now(), 'CONFIRMED')`;
  // SIL-1056 QA bounce 26/11 #1/#2 — staff D is the wave-5 Vũ Đình Cường
  // shape: positive held money (25M − 1.79M = 23.21M) then FULLY settled by a
  // legacy phiếu hoàn ứng with a POSITIVE refundAmount. The old held law
  // (recorded − dntt − returned) kept reporting 23.210.000 on
  // /advance-balances and in the report's own `remaining` while
  // remainingSigned read 0 — one response contradicting itself. A VOIDED
  // phiếu must settle nothing.
  const [staffD] = await sql`
    insert into users (username, full_name, role, password_hash)
    values ('nvd', 'Nhân Viên D', 'OPS', 'x') returning id`;
  staffDId = staffD.id;
  await sql`
    insert into advance_requests (requester_id, amount, reason, status, approved_at, requester_name_snapshot)
    values (${staffD.id}, 25000000, 'Tạm ứng chi phí cont', 'RECORDED', '2026-11-05 10:00', 'Nhân Viên D')`;
  await sql`
    insert into advance_settlements (code, forwarder_id, total_expense_amount, refund_amount, status, approved_by, approved_at)
    values ('PT-2611-0011', ${staffD.id}, '1790000', '23210000', 'RECORDED', ${staffD.id}, '2026-11-21 10:00')`;
  await sql`
    insert into advance_settlements (code, forwarder_id, total_expense_amount, refund_amount, status, approved_by, approved_at)
    values ('PT-2611-VOID', ${staffD.id}, '0', '-5000000', 'VOIDED', ${staffD.id}, '2026-11-21 11:00')`;
  const [expD] = await sql`
    insert into ops_expense_entries (shipment_id, expense_type_code, amount, paid_by_id, paid_at, approval_status, fee_name)
    values (${lot.id}, 'LIFT_CHARGE', 1790000, ${staffD.id}, '2026-11-11', 'RECORDED', 'Phí nâng') returning id`;
  await sql`
    insert into expense_accounting_sources (source_kind, source_id, shipment_id, confirmed_at, status)
    values ('OPS', ${expD.id}, ${lot.id}, now(), 'CONFIRMED')`;
  // The scoped-đợt drill-down fixture: a lot owning B's advance allocation
  // and B's own confirmed cost — the batch branch law (allocated − ĐNTT đợt).
  const [drillLot] = await sql`
    insert into expense_reconciliations (code, ops_user_id, from_date, to_date, amount, advance_amount, created_by_id)
    values ('DOT-DRILL', ${staffB.id}, '2026-11-01', '2026-11-30', '300000', '100000', 1) returning id`;
  drillLotId = drillLot.id;
  const [bRequest] = await sql`
    select id from advance_requests where requester_id = ${staffB.id} limit 1`;
  await sql`
    insert into expense_reconciliation_advances (reconciliation_id, advance_request_id, amount)
    values (${drillLot.id}, ${bRequest.id}, '100000')`;
  await sql`
    update expense_accounting_sources set reconciliation_id = ${drillLot.id} where source_id = ${expB.id}`;

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
interface DrillItem { id: number; code: string | null; label: string; date: string | null; amount: number }
interface DrillGroup { label: string; items: DrillItem[]; total: number }
interface DrillBody {
  staffId: number;
  staffName: string;
  reconciliation?: { id: number; code: string; from: string; to: string };
  law: 'CANONICAL' | 'LOT_ALLOCATION';
  groups: { recorded: DrillGroup; dntt: DrillGroup; returned: DrillGroup; settled: DrillGroup };
  signedBalance: number;
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

    // SIL-1056 — the chi-bù phiếu settled staff C: the row STAYS (kỳ columns
    // keep their gross history) but Còn phải hoàn ứng converges to 0đ and
    // every lập-phiếu affordance signal turns off. The old gross fallback
    // resurrected −2.479.000 (the exact 655k-fork staging shape).
    const rowC = body.rows.find((row) => row.staffId === staffCId);
    assert.ok(rowC, 'staff C row must render');
    assert.equal(rowC.advancedRecorded, 1000000, 'ĐÃ ỨNG column keeps the recorded gross');
    assert.equal(rowC.dntt, 3479000);
    assert.equal(rowC.remainingSigned, 0, 'phiếu chi bù tất toán xong → 0đ, không ghost âm');
    assert.equal(rowC.needsCollection, false);
    assert.equal(rowC.direction, 'KHONG_CON_GI');
    assert.equal(rowC.note, 'Không còn chênh lệch');
  });

  test('SIL-1056: totals.remainingSigned nets the settlement phiếu — = Σ rows (dòng đã tất toán đóng góp 0), không còn bằng hiệu gross', async () => {
    const res = await fetch(baseUrl + '/api/expense-accounting/reconciliation-report?from=2026-11-01&to=2026-11-30');
    assert.equal(res.status, 200);
    const body = (await res.json()) as ReportBody;
    const sumRows = body.rows.reduce((sum, row) => sum + row.remainingSigned, 0);
    assert.equal(body.totals.advancedRecorded, 26420000, '1.420.000 (A+B+C) + 25.000.000 (D)');
    assert.equal(body.totals.dntt, 5614000, '3.824.000 (A+B+C) + 1.790.000 (D)');
    assert.equal(body.totals.remainingSigned, sumRows, 'tổng cột = Σ dòng');
    assert.equal(body.totals.remainingSigned, 75000, '275.000 + (−200.000) + 0 + 0 — hai phiếu đã tất toán rút C và D về 0');
    assert.notEqual(
      body.totals.remainingSigned,
      body.totals.advancedRecorded - body.totals.dntt,
      'hiệu gross (20.806.000) là con số của fallback cũ — đã bỏ, tổng phải khớp Σ canonical',
    );
  });

  test('SIL-1056 bounce #1/#2: remaining == max(0, remainingSigned) — settled staff never reads 23.210.000 beside 0', async () => {
    const res = await fetch(baseUrl + '/api/expense-accounting/reconciliation-report?from=2026-11-01&to=2026-11-30');
    assert.equal(res.status, 200);
    const body = (await res.json()) as ReportBody;
    // Staff D = the wave-5 VĐ Cường shape: positive held money fully settled
    // by a POSITIVE-refund legacy phiếu. The old held law kept `remaining` at
    // 23.210.000 while remainingSigned read 0 — the API contradicting itself
    // in one response, and /advance-balances (same authority) contradicting
    // the Ví Ops screens.
    const rowD = body.rows.find((row) => row.staffId === staffDId);
    assert.ok(rowD, 'staff D row must render');
    assert.equal(rowD.remainingSigned, 0, 'phiếu hoàn ứng +23.210.000 tất toán xong → 0đ');
    assert.equal(rowD.remaining, 0, '`remaining` reads the SAME settled law — no 23.210.000 ghost beside 0');
    assert.equal(rowD.needsCollection, false);
    assert.equal(rowD.direction, 'KHONG_CON_GI');
    // A chi-bù phiếu (C) and the settled row behave identically on both views.
    const rowC = body.rows.find((row) => row.staffId === staffCId);
    assert.ok(rowC);
    assert.equal(rowC.remaining, 0);
    assert.equal(rowC.remainingSigned, 0);
    // Floor law intact: negative canonical keeps remaining ≥ 0 at the floor.
    const rowB = body.rows.find((row) => row.staffId === staffBId);
    assert.ok(rowB);
    assert.equal(rowB.remainingSigned, -200000);
    assert.equal(rowB.remaining, 0, 'âm không phải tiền đang nắm — sổ quỹ giữ 0');
  });

  test('SIL-1056 bounce #3: drill-down lists the transactions composing the cell (KB K2.117)', async () => {
    // Unscoped — canonical law, whole book: D = 25M đã ứng − 1.79M ĐNTT −
    // 23.21M đã tất toán (VOIDED phiếu settles nothing) = 0.
    const drillD = await fetch(baseUrl + `/api/expense-accounting/reconciliation-report/drill-down?opsUserId=${staffDId}`);
    assert.equal(drillD.status, 200);
    const dd = (await drillD.json()) as DrillBody;
    assert.equal(dd.law, 'CANONICAL');
    assert.equal(dd.groups.recorded.total, 25000000);
    assert.equal(dd.groups.dntt.total, 1790000);
    assert.equal(dd.groups.returned.total, 0);
    assert.equal(dd.groups.settled.total, 23210000, 'VOIDED phiếu never settles — only the RECORDED phiếu counts');
    assert.deepEqual(dd.groups.settled.items.map((item) => item.code), ['PT-2611-0011']);
    assert.equal(dd.signedBalance, 0, 'the footer is the settlement authority — khớp the cell');

    const drillA = await fetch(baseUrl + `/api/expense-accounting/reconciliation-report/drill-down?opsUserId=${staffAId}`);
    assert.equal(drillA.status, 200);
    const da = (await drillA.json()) as DrillBody;
    assert.equal(da.groups.recorded.total, 320000);
    assert.equal(da.groups.dntt.total, 45000);
    assert.equal(da.groups.settled.items.length, 0);
    assert.equal(da.signedBalance, 275000, '+275.000 = 320.000 − 45.000, khớp the cell the click came from');

    // Scoped to the đợt — the batch branch law (allocations − lot ĐNTT).
    const drillB = await fetch(baseUrl + `/api/expense-accounting/reconciliation-report/drill-down?opsUserId=${staffBId}&reconciliationId=${drillLotId}`);
    assert.equal(drillB.status, 200);
    const db = (await drillB.json()) as DrillBody;
    assert.equal(db.law, 'LOT_ALLOCATION');
    assert.ok(db.reconciliation, 'the đợt rides along so the dialog can name it');
    assert.equal(db.groups.recorded.total, 100000, 'allocations the lot owns');
    assert.equal(db.groups.dntt.total, 300000, 'costs the lot owns');
    assert.equal(db.groups.settled.items.length, 0, 'lot law nets allocations vs ĐNTT only');
    assert.equal(db.signedBalance, -200000, '100.000 phân bổ − 300.000 ĐNTT đợt');
  });
});

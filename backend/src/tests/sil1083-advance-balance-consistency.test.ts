// SIL-1083 — "một cách tính quỹ, mọi nơi mở cùng khoản chi/số dư phải cùng
// thông tin": the advance balance must read ONE law on every surface that
// opens it.
//
// QA wave-5 re-run (26/11, staging build b9ab12e1): Vũ Đình Cường — đã ứng
// 25.000.000, ĐNTT 1.790.000, đã tất toán qua phiếu 23.210.000 — read
// `remaining` 23.210.000 BESIDE `remainingSigned` 0 inside ONE reconciliation
// response, while /advance-balances DROPPED him from the list and the fund book
// still showed "Tạm ứng OPS còn tồn 23.210.000 ₫": three surfaces, three
// answers for one person.
//
// The law every surface shares (per staff, whole book):
//
//   held      = ĐÃ ỨNG (RECORDED phiếu) − ĐNTT (chi đã xác nhận)
//               − đã nộp lại (phiếu THU IN) − đã tất toán qua phiếu
//               (advance_settlements.refundAmount, đúng dấu)   → floored ≥ 0
//   canonical = the SAME expression, signed (a deficit stays negative)
//
// so `remaining` == max(0, `remainingSigned`) by construction, and no surface
// can show money another surface already settled.
//
// Harness: throwaway schema-only DB behind the REAL routers (the
// reconciliation-report-remaining pattern), so the assertions run on the
// shipped endpoints, not on a re-implementation of the law.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import express from 'express';
import type { Server } from 'node:http';
import postgres from 'postgres';
import { ApiError } from '../errors';
import { Role } from '@tingting/shared';

const TMP_DB = `sil1083_balance_${Date.now().toString(36)}`;
const TMP_URL = 'postgres://postgres:postgres@localhost:5441/' + TMP_DB;
// Must precede every dynamic import of db-touching modules (db/config reads
// this at module init).
process.env.DATABASE_URL = TMP_URL;

let sql: postgres.Sql;
let server: Server;
let baseUrl: string;
/** Đã ứng 25.000.000 − ĐNTT 1.790.000 = 23.210.000, đã tất toán trọn → 0. */
let curongId: number;
/** Còn nắm tiền thật: 5.000.000 − 700.000 = 4.300.000. */
let holderId: number;
/** Chi bù tất toán: 1.000.000 − 3.479.000 + 2.479.000 = 0. */
let chiBuId: number;
/** The fund book reads `db`, so it must be imported AFTER the env points at
 *  the throwaway database — hence the dynamic import, not a static one. */
let listFundBook: (source: 'COMPANY' | 'TM') => Promise<FundBook>;

const HELD = 4_300_000;

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

  const [customer] = await sql`insert into customers (name) values ('Khách số dư tạm ứng') returning id`;
  const [lot] = await sql`
    insert into shipments (customer_id, cargo_mode, shipment_code, status, created_by)
    values (${customer.id}, 'FCL', 'RRT-S1083', 'PENDING_DATE', null) returning id`;
  const [curong] = await sql`
    insert into users (username, full_name, role, password_hash)
    values ('nvd', 'Vũ Đình Cường', 'OPS', 'x') returning id`;
  const [holder] = await sql`
    insert into users (username, full_name, role, password_hash)
    values ('nvhold', 'Nhân Viên Giữ Tiền', 'OPS', 'x') returning id`;
  const [chiBu] = await sql`
    insert into users (username, full_name, role, password_hash)
    values ('nvb', 'Nhân Viên Chi Bù', 'OPS', 'x') returning id`;
  curongId = curong.id;
  holderId = holder.id;
  chiBuId = chiBu.id;

  await sql`
    insert into advance_requests (requester_id, amount, reason, status, approved_at, requester_name_snapshot)
    values (${curong.id}, 25000000, 'Tạm ứng chi phí cont', 'RECORDED', '2026-11-05 10:00', 'Vũ Đình Cường')`;
  await sql`
    insert into advance_requests (requester_id, amount, reason, status, approved_at, requester_name_snapshot)
    values (${holder.id}, 5000000, 'Tạm ứng chi phí cont', 'RECORDED', '2026-11-05 11:00', 'Nhân Viên Giữ Tiền')`;
  await sql`
    insert into advance_requests (requester_id, amount, reason, status, approved_at, requester_name_snapshot)
    values (${chiBu.id}, 1000000, 'Tạm ứng chi phí cont', 'RECORDED', '2026-11-05 12:00', 'Nhân Viên Chi Bù')`;

  // The settled phiếu (refundAmount dương = nhân viên nộp lại tiền).
  await sql`
    insert into advance_settlements (code, forwarder_id, total_expense_amount, refund_amount, status, approved_by, approved_at)
    values ('PT-2611-0011', ${curong.id}, '1790000', '23210000', 'RECORDED', ${curong.id}, '2026-11-21 10:00')`;
  // The chi-bù phiếu (refundAmount âm = công ty trả thêm phần chi vượt ứng).
  await sql`
    insert into advance_settlements (code, forwarder_id, total_expense_amount, refund_amount, status, approved_by, approved_at)
    values ('PT-2611-0010', ${chiBu.id}, '3479000', '-2479000', 'RECORDED', ${chiBu.id}, '2026-11-21 11:00')`;

  const confirmedCost = async (staffId: number, amount: number, day: string) => {
    const [entry] = await sql`
      insert into ops_expense_entries (shipment_id, expense_type_code, amount, paid_by_id, paid_at, approval_status, fee_name)
      values (${lot.id}, 'LIFT_CHARGE', ${amount}, ${staffId}, ${day}, 'RECORDED', 'Phí nâng') returning id`;
    await sql`
      insert into expense_accounting_sources (source_kind, source_id, shipment_id, confirmed_at, status)
      values ('OPS', ${entry.id}, ${lot.id}, now(), 'CONFIRMED')`;
  };
  await confirmedCost(curong.id, 1_790_000, '2026-11-11');
  await confirmedCost(holder.id, 700_000, '2026-11-12');
  await confirmedCost(chiBu.id, 3_479_000, '2026-11-13');

  // Dynamic import is REQUIRED (not stylistic): the routers transitively
  // import db, whose drizzle client binds DATABASE_URL at module init — a
  // static import would bind the DEV database before the before() above
  // points the env at the throwaway one.
  const { default: cashRoutes } = await import('../routes/expense-accounting-cash');
  const { default: advancesRoutes } = await import('../routes/financial/advances.routes');
  ({ listFundBook } = await import('../services/treasury-fund-book.service'));

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
  app.use('/api', advancesRoutes);
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
interface BalanceBody {
  totalOutstanding: string;
  items: Array<{ forwarderId: number; name: string | null; outstanding: string }>;
}
interface FundBook {
  opsAdvance: { totalOutstanding: number; items: Array<{ staffId: number; staffName: string | null; outstanding: number }> };
}

async function readReport(): Promise<ReportBody> {
  const res = await fetch(baseUrl + '/api/expense-accounting/reconciliation-report?from=2026-11-01&to=2026-11-30');
  assert.equal(res.status, 200);
  return (await res.json()) as ReportBody;
}
async function readBalances(includeAll: boolean): Promise<BalanceBody> {
  const res = await fetch(baseUrl + '/api/advance-balances' + (includeAll ? '?includeAll=true' : ''));
  assert.equal(res.status, 200);
  return (await res.json()) as BalanceBody;
}
async function readFundBook(): Promise<FundBook> {
  assert.equal(typeof listFundBook, 'function', 'sổ quỹ phải nạp được trước khi đọc');
  return listFundBook('COMPANY');
}

describe('SIL-1083 — một số dư tạm ứng, mọi mặt đọc cùng một luật', () => {
  test('Báo cáo đối soát không tự mâu thuẫn: remaining == max(0, remainingSigned) ở mọi dòng', async () => {
    const body = await readReport();
    for (const row of body.rows) {
      assert.equal(
        row.remaining,
        Math.max(0, row.remainingSigned),
        `dòng ${row.staffName}: remaining ${row.remaining} phải là sổ quỹ của remainingSigned ${row.remainingSigned} — không được đứng cạnh nhau hai số khác nhau`,
      );
    }
    const curong = body.rows.find((row) => row.staffId === curongId);
    assert.ok(curong, 'dòng Vũ Đình Cường phải hiện (kỳ columns giữ lịch sử gốc)');
    assert.equal(curong.remaining, 0, 'đã tất toán trọn → không còn tiền nắm');
    assert.equal(curong.remainingSigned, 0, 'canonical = 25.000.000 − 1.790.000 − 23.210.000 = 0');
    assert.equal(curong.needsCollection, false);
    assert.equal(curong.direction, 'KHONG_CON_GI');
    assert.equal(
      body.totals.remaining,
      body.rows.reduce((sum, row) => sum + row.remaining, 0),
      'tổng sổ quỹ = Σ dòng',
    );
    assert.equal(
      body.totals.remainingSigned,
      body.rows.reduce((sum, row) => sum + row.remainingSigned, 0),
      'tổng có dấu = Σ dòng',
    );
    const holder = body.rows.find((row) => row.staffId === holderId);
    assert.equal(holder?.remaining, HELD, 'người còn nắm tiền: 5.000.000 − 700.000');
    assert.equal(holder?.remainingSigned, HELD);
    const chiBu = body.rows.find((row) => row.staffId === chiBuId);
    assert.equal(chiBu?.remaining, 0, 'chi bù đã tất toán → 0đ ở cả hai cột');
    assert.equal(chiBu?.remainingSigned, 0, 'chi bù âm cộng lại: 1.000.000 − 3.479.000 + 2.479.000 = 0');
  });

  test('/api/advance-balances không bỏ sót người đã tất toán và không báo số khác sổ quỹ', async () => {
    const held = await readBalances(false);
    assert.equal(
      held.items.find((item) => item.forwarderId === curongId),
      undefined,
      'đã tất toán trọn → không còn tồn tạm ứng, không được đứng 23.210.000',
    );
    assert.equal(
      Number(held.items.find((item) => item.forwarderId === holderId)?.outstanding),
      HELD,
      'người còn nắm tiền phải đọc đúng số dư',
    );
    assert.equal(Number(held.totalOutstanding), HELD, 'tổng tồn tạm ứng = Σ dòng đang nắm tiền');
  });

  test('/api/advance-balances?includeAll=true đọc CÙNG luật: cùng người, cùng con số', async () => {
    const all = await readBalances(true);
    assert.equal(
      all.items.find((item) => item.forwarderId === curongId),
      undefined,
      'số dư canonical 0 → không có dòng (đủ số dư → 0đ + tự ẩn nút)',
    );
    assert.equal(
      Number(all.items.find((item) => item.forwarderId === holderId)?.outstanding),
      HELD,
      'cùng người, cùng số với /advance-balances và sổ quỹ',
    );
    assert.equal(Number(all.totalOutstanding), HELD);
  });

  test('Sổ quỹ "Tạm ứng OPS còn tồn" khớp 100% hai mặt đối soát', async () => {
    const book = await readFundBook();
    assert.equal(
      book.opsAdvance.items.find((item) => item.staffId === curongId),
      undefined,
      'sổ quỹ không còn hiện 23.210.000 cho người đã tất toán',
    );
    assert.equal(
      book.opsAdvance.items.find((item) => item.staffId === holderId)?.outstanding,
      HELD,
      'sổ quỹ == /advance-balances == Báo cáo',
    );
    assert.equal(book.opsAdvance.totalOutstanding, HELD);
  });

  test('một người, một con số: đối soát = advance-balances = advance-balances(all) = sổ quỹ', async () => {
    const body = await readReport();
    const held = await readBalances(false);
    const all = await readBalances(true);
    const book = await readFundBook();
    const staffIds = new Set<number>([curongId, holderId, chiBuId]);
    for (const staffId of staffIds) {
      const fromReport = body.rows.find((row) => row.staffId === staffId)?.remaining ?? 0;
      const fromHeld = Number(held.items.find((item) => item.forwarderId === staffId)?.outstanding ?? 0);
      const fromAll = Number(all.items.find((item) => item.forwarderId === staffId)?.outstanding ?? 0);
      const fromBook = book.opsAdvance.items.find((item) => item.staffId === staffId)?.outstanding ?? 0;
      assert.equal(fromHeld, fromReport, `sổ quỹ vs /advance-balances (NV #${staffId})`);
      assert.equal(fromBook, fromReport, `sổ quỹ vs Báo cáo (NV #${staffId})`);
      assert.equal(
        Math.max(0, fromAll),
        fromReport,
        `canonical vs sổ quỹ (NV #${staffId}) — cùng một người, cùng một số dư`,
      );
    }
  });
});

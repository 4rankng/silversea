// SIL-1128 — endpoint-level regression gate for the bảng Kiểm soát lô hàng
// (GET /api/accounting/debit-board): a VOIDED ops fee and a REJECTED ops fee
// must NOT reach Phát sinh ĐV / Lạch Huyện ĐV / Tổng trả — the board reads
// the same LIVE money Chi tiết Debit reads. QA evidence 27/11 (lô 6
// EHPH26080202): the board showed 1.105.000 ₫ while Chi tiết Debit showed
// 705.000 ₫ (400.000 ₫ of voided fees), and deleting a 200.000 ₫ fee moved
// the detail but not the board.
// Harness: throwaway schema-only DB behind the REAL accounting-debit router
// (debit-merge-override-zero pattern).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import express from 'express';
import type { Server } from 'node:http';
import postgres from 'postgres';
import { ApiError } from '../errors';
import { Role } from '@tingting/shared';

const TMP_DB = `debit_board_void_scope_test_${Date.now().toString(36)}`;
const TMP_URL = 'postgres://postgres:postgres@localhost:5441/' + TMP_DB;
// Must precede every dynamic import of db-touching modules (db/config reads
// this at module init).
process.env.DATABASE_URL = TMP_URL;

let sql: postgres.Sql;
let server: Server;
let baseUrl: string;
let lotVoidedCode: string;
let lotZoneCode: string;

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

  // ── Seed the QA shape. LOT-VOIDED: one live RECORDED fee (705.000 — the
  // number Chi tiết Debit showed) + one VOIDED fee (200.000) + one REJECTED
  // fee (200.000): only the 705.000 may reach Phát sinh ĐV / Tổng trả.
  // LOT-ZONE: the Lạch Huyện seam — a live ZONE_SURCHARGE (cost 300.000,
  // customer charge 400.000) + a VOIDED twin (cost 999.000, charge 888.000):
  // only the live pair may reach Lạch Huyện ĐV / Lạch Huyện. ──
  const [customer] = await sql`insert into customers (name) values ('Khách board-void-scope') returning id`;
  const [voided] = await sql`
    insert into shipments (customer_id, cargo_mode, shipment_code, status, created_by)
    values (${customer.id}, 'FCL', 'DVS-VOID-1', 'DISPATCHED', null)
    returning id, shipment_code`;
  const [zone] = await sql`
    insert into shipments (customer_id, cargo_mode, shipment_code, status, created_by)
    values (${customer.id}, 'FCL', 'DVS-ZONE-2', 'DISPATCHED', null)
    returning id, shipment_code`;
  lotVoidedCode = voided.shipment_code;
  lotZoneCode = zone.shipment_code;
  await sql`
    insert into ops_expense_entries (shipment_id, expense_type_code, amount, paid_at, approval_status)
    values (${voided.id}, 'OTHER_PS', 705000, '2026-11-20', 'RECORDED')`;
  await sql`
    insert into ops_expense_entries (shipment_id, expense_type_code, amount, paid_at, approval_status)
    values (${voided.id}, 'OTHER_PS', 200000, '2026-11-20', 'VOIDED')`;
  await sql`
    insert into ops_expense_entries (shipment_id, expense_type_code, amount, paid_at, approval_status, rejection_reason)
    values (${voided.id}, 'OTHER_PS', 200000, '2026-11-20', 'REJECTED', 'Thiếu bằng chứng')`;
  await sql`
    insert into ops_expense_entries (shipment_id, expense_type_code, amount, customer_charge_amount, paid_at, approval_status)
    values (${zone.id}, 'ZONE_SURCHARGE', 300000, 400000, '2026-11-20', 'RECORDED')`;
  await sql`
    insert into ops_expense_entries (shipment_id, expense_type_code, amount, customer_charge_amount, paid_at, approval_status)
    values (${zone.id}, 'ZONE_SURCHARGE', 999000, 888000, '2026-11-20', 'VOIDED')`;

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

interface BoardRow {
  code: string | null;
  tra: { cuocTraDv: string | null; lachHuyenDv: string | null; phatSinhDv: string | null; tong1: string | null; phiRu: string | null };
  thu: { lachHuyen: string | null };
}

describe('GET /api/accounting/debit-board — VOID/REJECTED phí không còn vào Phát sinh ĐV + Tổng trả (SIL-1128)', () => {
  test('REGRESSION: lô có khoản void + reject → bảng khớp Chi tiết Debit (chỉ tiền LIVE)', async () => {
    const res = await fetch(baseUrl + '/api/accounting/debit-board');
    assert.equal(res.status, 200);
    const body = (await res.json()) as { total: number; items: BoardRow[] };

    const voidedLot = body.items.find((item) => item.code === lotVoidedCode);
    assert.ok(voidedLot, 'voided-fee lot must render');
    assert.equal(voidedLot.tra.phatSinhDv, '705000', 'only the LIVE fee reaches Phát sinh ĐV — không đếm VOIDED/REJECTED');
    assert.equal(voidedLot.tra.lachHuyenDv, null, 'no zone rows — Lạch Huyện ĐV stays null');
    assert.equal(voidedLot.tra.tong1, '705000', 'Tổng trả = the live fee alone — khớp Chi tiết Debit');

    const zoneLot = body.items.find((item) => item.code === lotZoneCode);
    assert.ok(zoneLot, 'zone lot must render');
    assert.equal(zoneLot.thu.lachHuyen, '400000', 'only the LIVE customer charge reaches Lạch Huyện');
    assert.equal(zoneLot.tra.lachHuyenDv, '300000', 'only the LIVE zone cost reaches Lạch Huyện ĐV');
    assert.equal(zoneLot.tra.tong1, '300000', 'Tổng trả counts the live zone cost only');
  });

  test('reject thêm một khoản → bảng không tăng (đường REJECT cùng gốc)', async () => {
    const [current] = await sql`select id from shipments where shipment_code = ${lotVoidedCode}`;
    await sql`
      insert into ops_expense_entries (shipment_id, expense_type_code, amount, paid_at, approval_status, rejection_reason)
      values (${current.id}, 'OTHER_PS', 500000, '2026-11-21', 'REJECTED', 'Từ chối phí kích hoạt')`;
    const res = await fetch(baseUrl + '/api/accounting/debit-board');
    assert.equal(res.status, 200);
    const body = (await res.json()) as { total: number; items: BoardRow[] };
    const voidedLot = body.items.find((item) => item.code === lotVoidedCode);
    assert.ok(voidedLot, 'voided-fee lot must render');
    assert.equal(voidedLot.tra.phatSinhDv, '705000', 'a newly REJECTED fee never moves the board');
    assert.equal(voidedLot.tra.tong1, '705000');
  });
});

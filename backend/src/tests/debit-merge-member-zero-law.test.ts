// SIL-1235 (K6.31/K6.63/K9.16/K9.27, KB Ch.9 §9.6 / Ch.6 §6.3) — endpoint
// regression gate for the REV-merge member's READ-TIME zero law. The staging
// shape QA pinned on build 2122c1a2 (28/11): 11/13 groups already read the
// writer's materialized 0₫, but legacy groups stamped BEFORE the member-zero
// law still carried full money on the member:
//   - d25e82a1: lô 1551 (member of 1550) returned revenue
//     {cuoc:"1200000", phuPhi:"320000", tong:"1520000"} — a full copy of the
//     principal from a stale trip_financial_state override stamp;
//   - 9c0f42bb: lô 1264 returned {cuoc:"0", phuPhi:"506714", tong:"506714"}
//     — freight zeroed but the stale pre-merge Phụ phí snapshot leaked.
// After the fix ANY lot with revGroupId != null AND revGroupOrder > 1 reads
// 0₫ in CƯỚC / PHỤ PHÍ / TỔNG on BOTH /api/accounting/debit-merge and
// /api/accounting/debit-board, regardless of stale stored override/snapshot
// money; the principal keeps its 1.520.000-shaped row and the ungrouped lot
// beside the group keeps today's numbers byte-for-byte.
// Harness: throwaway schema-only DB behind the REAL accounting-debit router
// (debit-merge-route-regression pattern).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import express from 'express';
import type { Server } from 'node:http';
import postgres from 'postgres';
import type { Sql } from 'postgres';
import { ApiError } from '../errors';
import { Role } from '@tingting/shared';

const TMP_DB = `debit_member_zero_test_${Date.now().toString(36)}`;
const TMP_URL = 'postgres://postgres:postgres@localhost:5441/' + TMP_DB;
// Must precede every dynamic import of db-touching modules (db/config reads
// this at module init).
process.env.DATABASE_URL = TMP_URL;

const GROUP_ID = 'sil1235-group-0000000000000000a1b2';
const PRINCIPAL_REF = 'BL-SIL1235-P';

let sql: Sql;
let server: Server;
let baseUrl: string;
let principalCode: string;
let memberCode: string;
let outsiderCode: string;

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

  // ── Seed the staging shape: Lô 1 (principal) carries the priced freeze;
  // the member carries STALE pre-law money on EVERY read channel at once —
  // the trip_financial_state override stamp (the d25e82a1 leak), the
  // pre-merge intake snapshot with its 320.000₫ Phụ phí (the 9c0f42bb
  // leak), and kế toán's stale SIL-805 cell overrides — so the gate must
  // hold no matter which channel would have won. An UNGROUPED outsider lot
  // with the same stale money stays untouched (the law is member-only). ──
  const [customer] = await sql`insert into customers (name, status) values ('Khách SIL-1235', 'ACTIVE') returning id`;
  const [principal] = await sql`
    insert into shipments (customer_id, cargo_mode, shipment_code, status, rev_group_id, rev_group_order, bl_number)
    values (${customer.id}, 'LCL', 'MZL-LO1-1', 'PENDING_DATE', ${GROUP_ID}, 1, ${PRINCIPAL_REF})
    returning id, shipment_code`;
  const [member] = await sql`
    insert into shipments (customer_id, cargo_mode, shipment_code, status, rev_group_id, rev_group_order)
    values (${customer.id}, 'LCL', 'MZL-LO2-2', 'PENDING_DATE', ${GROUP_ID}, 2)
    returning id, shipment_code`;
  const [outsider] = await sql`
    insert into shipments (customer_id, cargo_mode, shipment_code, status)
    values (${customer.id}, 'LCL', 'MZL-OUT-3', 'PENDING_DATE')
    returning id, shipment_code`;
  principalCode = principal.shipment_code;
  memberCode = member.shipment_code;
  outsiderCode = outsider.shipment_code;

  // The priced intake freezes (trip-NULL — the trip-less board grain).
  for (const lot of [principal.id, member.id, outsider.id]) {
    await sql`
      insert into freight_rate_snapshots (shipment_id, trip_id, freight_amount, surcharge_amount, total_amount, rate_terms_id, pricing_table_id, fuel_norm_id, fuel_price_period_id, billed_km, liters, fuel_delta, share_pct)
      values (${lot}, null, 1200000, 320000, 1520000, 7, 7, 3, 5, 300, 0, 0, 1)`;
  }

  // The member's stale override stamp (FB-095-style, full principal money).
  const [route] = await sql`insert into routes (name) values ('Tuyến SIL-1235') returning id`;
  const [trip] = await sql`
    insert into trips (customer_id, route_id, departure_date, shipment_id)
    values (${customer.id}, ${route.id}, '2026-11-27', ${member.id}) returning id`;
  await sql`
    insert into trip_financial_state (trip_id, revenue, revenue_overridden_at)
    values (${trip.id}, 1200000, now())`;

  // The member's stale SIL-805 cell overrides.
  await sql`
    insert into shipment_debit_rate_overrides (shipment_id, cuoc_thu, phu_ps, updated_by)
    values (${member.id}, 1200000, 320000, 1)`;

  // ── Real route stack: stub auth (Kế toán) → accounting-debit router ──
  // Dynamic import is REQUIRED here (shipment-children-fk pattern): the
  // router transitively imports db, whose drizzle client binds DATABASE_URL
  // at module init — a static import would bind the DEV database before
  // before() points the env at the throwaway one above.
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
  revenue: { cuoc: string | null; cuocReason: string | null; phuPhi: string | null; tong: string | null };
  control: { tongTc: string | null; lockStatus: 'LOCKED' | 'OPEN' };
  revGroupOrder: number | null;
  lclParams: { ghepCungRef: string | null } | null;
}

interface BoardItem {
  code: string;
  thu: { cuocThu: string | null; phuPs: string | null; tongThu: string | null };
  cuocThuAuto: string | null;
  lcl: { revGroupId: string | null; ghépCùngRef: string | null } | null;
}

const fetchJson = async (path: string): Promise<unknown> => {
  const res = await fetch(baseUrl + path);
  assert.equal(res.status, 200, `${path} must answer 200`);
  return res.json();
};

describe('SIL-1235 — lô phụ nhóm ghép đọc 0₫ trên cả hai bảng tiền, mọi kênh stored stale', () => {
  test('GET /api/accounting/debit-merge: member = 0₫ (cược/phụ phí/tổng/Tổng TC), Lô 1 giữ 1.520.000', async () => {
    const body = (await fetchJson('/api/accounting/debit-merge')) as { total: number; items: MergeItem[] };
    assert.equal(body.total, 3, 'both grouped lots + the outsider must render');

    const member = body.items.find((item) => item.code === memberCode);
    assert.ok(member, 'member lot must render');
    assert.equal(member.revGroupOrder, 2);
    assert.equal(member.revenue.cuoc, '0', 'stale trip_financial_state stamp never prices a lô phụ');
    assert.equal(member.revenue.phuPhi, '0', 'stale Phụ phí snapshot never prints on a lô phụ');
    assert.equal(member.revenue.tong, '0', 'member TỔNG reads the law 0₫');
    assert.equal(member.control.tongTc, '0', 'member Tổng TC reads the law 0₫');
    assert.equal(member.control.lockStatus, 'OPEN');
    assert.equal(member.revenue.cuocReason, 'Ghép cước cùng Bill BL-SIL1235-P');
    assert.equal(member.lclParams?.ghepCungRef, PRINCIPAL_REF, 'the Ghép-cước citation names the LIVE Lô 1');

    const principal = body.items.find((item) => item.code === principalCode);
    assert.ok(principal, 'principal lot must render');
    assert.equal(principal.revGroupOrder, 1);
    assert.equal(principal.revenue.cuoc, '1200000', 'Lô 1 keeps 100% of the group freight');
    assert.equal(principal.revenue.phuPhi, '320000');
    assert.equal(principal.revenue.tong, '1520000');
    assert.equal(principal.control.tongTc, '1520000');
    assert.equal(principal.lclParams?.ghepCungRef, null, 'Lô 1 carries no group citation');
  });

  test('GET /api/accounting/debit-board (chốt debit): member thu = 0₫, Lô 1 giữ nguyên, outsider không đụng', async () => {
    const body = (await fetchJson('/api/accounting/debit-board?includeHidden=true')) as { total: number; items: BoardItem[] };
    assert.equal(body.total, 3);

    const member = body.items.find((item) => item.code === memberCode);
    assert.ok(member, 'member lot must render');
    assert.equal(member.thu.cuocThu, '0', 'stale cuocThu override cell never prices a lô phụ');
    assert.equal(member.thu.phuPs, '0', 'the 9c0f42bb leak — stale Phụ PS — reads 0₫');
    assert.equal(member.thu.tongThu, '0', 'member Tổng thu reads the law 0₫');
    assert.equal(member.cuocThuAuto, '0', 'the auto anchor shows the law 0₫');
    assert.equal(member.lcl?.revGroupId, GROUP_ID);
    assert.equal(member.lcl?.ghépCùngRef, PRINCIPAL_REF);

    const principal = body.items.find((item) => item.code === principalCode);
    assert.ok(principal, 'principal lot must render');
    assert.equal(principal.thu.cuocThu, '1200000');
    assert.equal(principal.thu.phuPs, '320000');
    assert.equal(principal.thu.tongThu, '1520000');
    assert.equal(principal.lcl?.ghépCùngRef, null);

    // The zero law is member-only: the ungrouped outsider keeps today's
    // numbers byte-for-byte — same stale money, no group, no zeroing.
    const outsider = body.items.find((item) => item.code === outsiderCode);
    assert.ok(outsider, 'outsider lot must render');
    assert.equal(outsider.thu.cuocThu, '1200000');
    assert.equal(outsider.thu.phuPs, '320000');
    assert.equal(outsider.thu.tongThu, '1520000');
    assert.equal(outsider.lcl?.ghépCùngRef, null, 'ungrouped lot carries no group citation');
    assert.equal(outsider.lcl?.revGroupId, null);
  });

  test('GET /api/accounting/debit-merge: ungrouped outsider với cùng stale money đọc nguyên giá', async () => {
    const body = (await fetchJson('/api/accounting/debit-merge')) as { total: number; items: MergeItem[] };
    const outsider = body.items.find((item) => item.code === outsiderCode);
    assert.ok(outsider, 'outsider lot must render');
    assert.equal(outsider.revenue.cuoc, '1200000');
    assert.equal(outsider.revenue.phuPhi, '320000');
    assert.equal(outsider.revenue.tong, '1520000');
    assert.equal(outsider.control.tongTc, '1520000');
    assert.equal(outsider.revGroupOrder, null);
  });
});

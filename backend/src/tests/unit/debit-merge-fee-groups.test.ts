// Task 2.3 (18/11) — Bảng Ghép bộ Debit: pure-law tests, no db (BE unit-only
// law). Covers (1) the group-4 category mapping (CSHT/LIFT/DROP/catch-all +
// totals exact + negative-row law), (2) the group-5 no-invoice families
// (OPS_REGULAR = 'Phí GN', OPS_INCIDENTAL = 'Phí PS', Thực-thu sums, unknown
// stays null), (3) the CUS scoping decision — own-only by default, widened
// only by the exact `team: 'true'` wire value (extends the
// cus-visibility.test.ts fake-executor pattern).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PgDialect } from 'drizzle-orm/pg-core';

import { Role } from '@tingting/shared';
import {
  buildDebitMergeChiHo,
  buildDebitMergeNoInvoice,
  debitChiHoGroupOf,
  debitMergeIncludeTeam,
  debitMergeScopeConditions,
} from '../../services/debit-merge.service';

const dialect = new PgDialect();

describe('debitChiHoGroupOf — nhóm phụ theo category của catalog', () => {
  it('CSHT → csht, LIFT → lift, DROP → drop, còn lại (KHAC/HQGS/null) → other', () => {
    assert.equal(debitChiHoGroupOf('CSHT'), 'csht');
    assert.equal(debitChiHoGroupOf('LIFT'), 'lift');
    assert.equal(debitChiHoGroupOf('DROP'), 'drop');
    assert.equal(debitChiHoGroupOf('KHAC'), 'other');
    assert.equal(debitChiHoGroupOf('HQGS'), 'other');
    assert.equal(debitChiHoGroupOf('PHAT_SINH'), 'other');
    assert.equal(debitChiHoGroupOf(null), 'other');
    assert.equal(debitChiHoGroupOf(undefined), 'other');
  });
});

describe('buildDebitMergeChiHo — 4 nhóm phụ, tổng chính xác', () => {
  const rows = [
    // CSHT: Số HĐ | Tiền — charge rides, paid only backs the amount.
    { category: 'CSHT', charge: '50000', paid: '50000', feeName: 'Phí hạ tầng', invoiceNumber: 'HD-001' , pending: false },
    // LIFT (nâng-cont): Tiền = charge, Thực chi = paid.
    { category: 'LIFT', charge: '1200000', paid: '1150000', feeName: 'Phí nâng vỏ', invoiceNumber: 'HD-002' , pending: false },
    // DROP (hạ-cont): same shape.
    { category: 'DROP', charge: '980000', paid: '980000', feeName: 'Phí hạ hàng', invoiceNumber: 'HD-003' , pending: false },
    // KHAC catch-all: Số tiền + Tên phí.
    { category: 'KHAC', charge: '300000', paid: '300000', feeName: 'Phí vệ sinh', invoiceNumber: 'HD-004' , pending: false },
    // Unclassified category → the catch-all too (no money leaves the totals).
    { category: null, charge: '70000', paid: '70000', feeName: 'Chưa phân loại', invoiceNumber: null , pending: false },
  ];

  it('mỗi dòng rơi đúng nhóm phụ với đúng các trường', () => {
    const chiHo = buildDebitMergeChiHo(rows);
    assert.equal(chiHo.csht.length, 1);
    assert.deepEqual(chiHo.csht[0], { invoiceNumber: 'HD-001', amount: '50000' });
    assert.equal(chiHo.lift.length, 1);
    assert.deepEqual(chiHo.lift[0], { invoiceNumber: 'HD-002', amount: '1200000', actualAmount: '1150000' });
    assert.equal(chiHo.drop.length, 1);
    assert.deepEqual(chiHo.drop[0], { invoiceNumber: 'HD-003', amount: '980000', actualAmount: '980000' });
    assert.equal(chiHo.other.length, 2);
    assert.deepEqual(chiHo.other[0], { invoiceNumber: 'HD-004', amount: '300000', feeName: 'Phí vệ sinh' });
    assert.deepEqual(chiHo.other[1], { invoiceNumber: null, amount: '70000', feeName: 'Chưa phân loại' });
  });

  it('tổng Tiền mỗi nhóm khớp chính xác tổng dòng', () => {
    const chiHo = buildDebitMergeChiHo(rows);
    const sum = (list: Array<{ amount: string }>) => list.reduce((acc, fee) => acc + Number(fee.amount), 0);
    assert.equal(sum(chiHo.csht), 50000);
    assert.equal(sum(chiHo.lift), 1200000);
    assert.equal(sum(chiHo.drop), 980000);
    assert.equal(sum(chiHo.other), 370000);
  });

  it('dòng âm bị loại (card 20260928_197 — như thể không tồn tại)', () => {
    const chiHo = buildDebitMergeChiHo([
      { category: 'LIFT', charge: '1200000', paid: '1150000', feeName: 'Phí nâng vỏ', invoiceNumber: 'HD-002' , pending: false },
      { category: 'LIFT', charge: null, paid: '-50000', feeName: 'Điều chỉnh', invoiceNumber: 'HD-009' , pending: false },
    ]);
    assert.equal(chiHo.lift.length, 1);
    assert.equal(chiHo.lift[0]?.invoiceNumber, 'HD-002');
  });

  it('charge null → Tiền đọc paid (đồng nhất charge = amount của dòng có hóa đơn)', () => {
    const chiHo = buildDebitMergeChiHo([
      { category: 'DROP', charge: null, paid: '640000', feeName: 'Phí hạ vỏ', invoiceNumber: 'HD-005' , pending: false },
    ]);
    assert.equal(chiHo.drop[0]?.amount, '640000');
    assert.equal(chiHo.drop[0]?.actualAmount, '640000');
  });

  it('dòng chưa Kế toán duyệt → pending:true cắm trên dòng phí, tổng không đổi (SIL-883 3.1)', () => {
    const chiHo = buildDebitMergeChiHo([
      { category: 'KHAC', charge: '300000', paid: '300000', feeName: 'Phí vệ sinh', invoiceNumber: 'HD-004', pending: true },
    ]);
    assert.deepEqual(chiHo.other[0], { invoiceNumber: 'HD-004', amount: '300000', feeName: 'Phí vệ sinh', pending: true });

    const no = buildDebitMergeNoInvoice([
      { costGroup: 'OPS_REGULAR', charge: '450000', paid: '450000', feeName: 'Chọn vỏ', pending: true },
    ]);
    assert.equal(no.gnFee, 450000);
    assert.equal(no.gnFeePending, true);
    assert.deepEqual(no.fees[0], { name: 'Chọn vỏ', amount: 450000, pending: true });
  });

  it('lô không có dòng nào → 4 nhóm rỗng (không bao giờ là 0 bịa)', () => {
    assert.deepEqual(buildDebitMergeChiHo([]), { csht: [], lift: [], drop: [], other: [] });
  });
});

describe('buildDebitMergeNoInvoice — hai họ phí không hóa đơn Ops (SIL-876: Phí | Thực thu từng họ)', () => {
  it('OPS_REGULAR (Giao nhận Ops) và OPS_INCIDENTAL (Phát sinh Ops) tách đúng cặp Phí / Thực thu', () => {
    const result = buildDebitMergeNoInvoice([
      { costGroup: 'OPS_REGULAR', charge: '450000', paid: '450000', feeName: 'Làm hàng luồng xanh' , pending: false },
      { costGroup: 'OPS_REGULAR', charge: '0', paid: '200000', feeName: 'Chọn vỏ' , pending: false },
      { costGroup: 'OPS_INCIDENTAL', charge: '180000', paid: '180000', feeName: 'Sửa tờ khai' , pending: false },
    ]);
    // Phí = entry amount; Thực thu = customerChargeAmount (charge).
    assert.equal(result.gnFee, 650000);
    assert.equal(result.gnPaid, 450000);
    assert.equal(result.psFee, 180000);
    assert.equal(result.psPaid, 180000);
    assert.equal(result.fees.length, 3);
    assert.deepEqual(result.fees[0], { name: 'Làm hàng luồng xanh', amount: 450000 });
  });

  it('lô không có hàng nào của một họ → các ô của họ đó là null (chưa xác định, không bịa 0)', () => {
    const result = buildDebitMergeNoInvoice([
      { costGroup: 'OPS_REGULAR', charge: '10000', paid: '10000', feeName: 'Chi hải quan' , pending: false },
    ]);
    assert.equal(result.gnFee, 10000);
    assert.equal(result.gnPaid, 10000);
    assert.equal(result.psFee, null);
    assert.equal(result.psPaid, null);
  });

  it('dòng chưa thương lượng charge → Thực thu null, Phí vẫn biết', () => {
    const result = buildDebitMergeNoInvoice([
      { costGroup: 'OPS_REGULAR', charge: null, paid: '70000', feeName: 'Chọn vỏ' , pending: false },
    ]);
    assert.equal(result.gnFee, 70000);
    assert.equal(result.gnPaid, null);
  });

  it('lô không có dòng nào → cả bốn null, fees rỗng', () => {
    const result = buildDebitMergeNoInvoice([]);
    assert.equal(result.gnFee, null);
    assert.equal(result.gnPaid, null);
    assert.equal(result.psFee, null);
    assert.equal(result.psPaid, null);
    assert.deepEqual(result.fees, []);
  });

  it('dòng âm bị loại khỏi cả tổng và danh sách', () => {
    const result = buildDebitMergeNoInvoice([
      { costGroup: 'OPS_INCIDENTAL', charge: '180000', paid: '180000', feeName: 'Sửa tờ khai' , pending: false },
      { costGroup: 'OPS_INCIDENTAL', charge: null, paid: '-90000', feeName: 'Hủy khoản' , pending: false },
    ]);
    assert.equal(result.psFee, 180000);
    assert.equal(result.psPaid, 180000);
    assert.equal(result.fees.length, 1);
  });
});

describe('debitMergeScopeConditions — CUS own-only vs team', () => {
  const actor = { userId: 7, role: Role.CUS as const };
  const staff = { userId: 3, role: Role.ACCOUNTANT as const };

  it('team chỉ mở rộng với đúng chuỗi \'true\'', () => {
    assert.equal(debitMergeIncludeTeam(undefined), false);
    assert.equal(debitMergeIncludeTeam(null), false);
    assert.equal(debitMergeIncludeTeam('false'), false);
    assert.equal(debitMergeIncludeTeam('true'), true);
  });

  it('vai staff không bao giờ bị scope — không điều kiện, không đụng DB', async () => {
    let touched = false;
    const executor = new Proxy({}, {
      get: () => { touched = true; return () => { touched = true; }; },
    }) as never;
    const conditions = await debitMergeScopeConditions(executor, staff, 'true');
    assert.deepEqual(conditions, []);
    assert.equal(touched, false);
  });

  it('CUS mặc định (team off): 3 nhánh own-only, KHÔNG nhánh co-members', async () => {
    const conditions = await debitMergeScopeConditions(fakeMembersExecutor(), actor, 'false');
    assert.equal(conditions.length, 1);
    const { sql } = dialect.sqlToQuery(conditions[0]!);
    assert.equal((sql.match(/created_by/g) ?? []).length, 3);
    // The co-members arm would render `created_by in (…)` — absent when off.
    assert.equal(/created_by in \(/.test(sql), false);
  });

  it('CUS team=1: thêm nhánh co-members (nhóm ACTIVE)', async () => {
    const conditions = await debitMergeScopeConditions(fakeMembersExecutor([11, 12]), actor, 'true');
    assert.equal(conditions.length, 1);
    const rendered = dialect.sqlToQuery(conditions[0]!);
    assert.equal(rendered.params.filter((param) => param === 11 || param === 12).length, 2);
  });

  it('CUS team=1 nhưng không có nhóm nào → still own-only arms', async () => {
    const conditions = await debitMergeScopeConditions(fakeMembersExecutor([]), actor, 'true');
    const { sql } = dialect.sqlToQuery(conditions[0]!);
    assert.equal((sql.match(/created_by/g) ?? []).length, 3);
  });
});

/** Minimal executor shape for the team query inside cusVisibilityCondition:
 *  the members join select is awaited straight at .where() (drizzle builders
 *  are thenable), so the fake's where() must be awaitable — the same trick
 *  cus-visibility.test.ts uses. */
function fakeMembersExecutor(members: number[] = []) {
  const chain = {
    innerJoin: () => chain,
    where: () => ({
      then: (resolve: (rows: unknown) => unknown, reject: (err: unknown) => unknown) =>
        Promise.resolve(members.map((userId) => ({ userId }))).then(resolve, reject),
    }),
  };
  return {
    select: () => ({ from: () => chain }),
  } as never;
}

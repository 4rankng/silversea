// SIL-1061 (K2.118 / K2.150) — partial deposit-recovery laws, pinned db-free
// (owner ruling: BE tests are unit-only; the laws live in pure helpers the
// service calls, same seam style as deposit-intake-laws.test.ts):
// - resolveRefundTick: the tick records số đã hoàn từng phần + ngày nhận thực
//   tế; 0 ≤ đã hoàn ≤ số cược (vượt bị chặn); đã hoàn > 0 ⇒ ngày nhận bắt
//   buộc; legacy default tick vẫn hoàn TOÀN BỘ và đóng dấu ngày hôm nay;
//   tích lại khi còn tiền chưa hoàn được là đợt TIẾP (không phải double-post),
//   còn "hoàn 2 lần" trên dòng đã đủ là 409 đúng như staging ghi nhận;
// - depositRefundLedgerEntry / depositRefundTreasuryMovement: tiền hoàn vẫn
//   là bút toán quỹ treasury IN mã DEPOSIT_TRACKER:* (KHÔNG phải doanh thu
//   vận tải) — regression SIL-1061 §3;
// - resolveRecoveryEdit: hộp "Cập nhật hoàn cược" ghi/sửa 2 trường với cùng
//   luật (trượt quá số cược bị chặn, không giảm sau khi bút toán đã chạy,
//   còn lại = 0 ⇒ ĐÃ hoàn cược);
// - depositReceived / unrefundedDepositsTotal / computeDepositWeeks: hai mặt
//   tiền còn lại của hoàn cược dùng CHUNG một luật — tiền đã về = số đã hoàn,
//   tiền còn nợ = số cược − đã hoàn. Trước đây cảnh báo "Container chưa hoàn
//   cược" (/accounting) cộng trọn số cược và series "Đã hoàn cược" của biểu
//   đồ tuần bỏ sót lô hoàn một phần (card 370 R4: cảnh báo phải trùng bảng
//   theo dõi hoàn cược).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { ApiError } from '../../errors';
import { TxnType } from '@tingting/shared';
import {
  computeDepositWeeks,
  depositReceived,
  depositRefundLedgerEntry,
  depositRefundPhysicalReference,
  depositRefundTreasuryMovement,
  depositRemaining,
  resolveRecoveryEdit,
  resolveRefundTick,
  unrefundedDepositsTotal,
  type DepositWeeklySourceRow,
} from '../../services/deposit-refund-tracker.service';

const TODAY = '2026-11-26';

const row = (overrides: Partial<Parameters<typeof resolveRefundTick>[0]> = {}) => ({
  id: 1,
  status: 'CHUA_HOAN_CUOC' as const,
  depositAmount: '2000000', // KB ví dụ: cược 2.000.000
  recoveredAmount: null as string | null,
  ...overrides,
});

const httpStatus = (run: () => unknown): number => {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof ApiError, 'expected ApiError');
    return error.statusCode;
  }
  throw new Error('expected the law to throw');
};

describe('resolveRefundTick — SIL-1061 partial tick laws', () => {
  test('default tick (legacy empty body) refunds EVERYTHING outstanding and stamps today', () => {
    const plan = resolveRefundTick(row(), {}, TODAY);
    assert.deepEqual(plan, { tranche: 2_000_000, newRecovered: 2_000_000, refundReceivedDate: TODAY, status: 'DA_HOAN_CUOC' });
  });

  test('KB example: cược 2.000.000, đã hoàn 500.000 → còn 1.500.000, dòng chưa hoàn hết', () => {
    const plan = resolveRefundTick(row(), { recoveredAmount: 500_000, refundReceivedDate: '2026-11-20' }, TODAY);
    assert.equal(plan.tranche, 500_000);
    assert.equal(plan.newRecovered, 500_000);
    assert.equal(plan.status, 'CHUA_HOAN_CUOC');
    assert.equal(depositRemaining({ depositAmount: '2000000', recoveredAmount: '500000' }), 1_500_000);
  });

  test('second tranche: a PARTIALLY ticked row ticks the remainder and completes', () => {
    const partial = row({ recoveredAmount: '500000' });
    const plan = resolveRefundTick(partial, { expectedDepositAmount: 2_000_000 }, TODAY);
    assert.deepEqual(plan, { tranche: 1_500_000, newRecovered: 2_000_000, refundReceivedDate: TODAY, status: 'DA_HOAN_CUOC' });
  });

  test('vượt số cược bị chặn: 400', () => {
    assert.equal(httpStatus(() => resolveRefundTick(row(), { recoveredAmount: 2_500_000, refundReceivedDate: TODAY }, TODAY)), 400);
    assert.equal(httpStatus(() => resolveRefundTick(row({ recoveredAmount: '500000' }), { recoveredAmount: 1_600_000, refundReceivedDate: TODAY }, TODAY)), 400);
  });

  test('đã hoàn > 0 với số tiền explicit mà thiếu ngày nhận thực tế → 400', () => {
    assert.equal(httpStatus(() => resolveRefundTick(row(), { recoveredAmount: 500_000 }, TODAY)), 400);
  });

  test('hoàn 2 lần trên dòng ĐÃ đủ bị chặn 409 (staging repro giữ nguyên)', () => {
    assert.equal(httpStatus(() => resolveRefundTick(row({ status: 'DA_HOAN_CUOC', recoveredAmount: '2000000' }), {}, TODAY)), 409);
    assert.equal(httpStatus(() => resolveRefundTick(row({ recoveredAmount: '2000000' }), {}, TODAY)), 409);
  });

  test('dòng chưa có số tiền cược vẫn 409 như cũ', () => {
    assert.equal(httpStatus(() => resolveRefundTick(row({ depositAmount: '0' }), {}, TODAY)), 409);
  });

  test('expectedDepositAmount lệch số tiền cược → 409 stale guard giữ nguyên', () => {
    assert.equal(httpStatus(() => resolveRefundTick(row(), { expectedDepositAmount: 4_000_000 }, TODAY)), 409);
    assert.equal(httpStatus(() => resolveRefundTick(row(), { expectedDepositAmount: -5 }, TODAY)), 400);
  });
});

describe('depositRefundLedgerEntry / depositRefundTreasuryMovement — SIL-1061 §3 regression', () => {
  const billRow = { id: 42, shipmentId: 7 as number | null, billNumber: 'JH202609258' };

  test('tiền hoàn là bút toán quỹ DEPOSIT_TRACKER:* — KHÔNG phải doanh thu vận tải', () => {
    const entry = depositRefundLedgerEntry(billRow, 500_000);
    assert.equal(entry.receiptId, 'DEPOSIT_TRACKER:42');
    assert.equal(entry.txnType, TxnType.ADJUSTMENT);
    assert.equal(entry.debit, 0);
    assert.equal(entry.credit, 500_000);
    assert.match(entry.note, /Hoàn cược container - Bill JH202609258/);
  });

  test('mỗi đợt tích = một movement IN đúng số tiền đợt đó', () => {
    const movement = depositRefundTreasuryMovement(3, billRow, 1_500_000, 99, 5, '2026-11-26');
    assert.equal(movement.direction, 'IN');
    assert.equal(movement.amount, 1_500_000);
    assert.equal(movement.treasuryAccountId, 3);
    assert.equal(movement.ledgerEntryId, 99);
    assert.equal(movement.physicalReference, 'HOAN-CUOC-42-JH202609258');
    assert.equal(movement.createdBy, 5);
  });

  // SIL-1061 R4 — mã giao dịch phải duy nhất THEO TỪNG ĐỢT hoàn: đợt 1 giữ mã
  // gốc (R1–R3 regression), đợt 2+ xoay hậu tố -2/-3 (luật xoay của phoi-phieu
  // -R2/-R3, a6cdb613). Mã cố định theo dòng made đợt 2 die 409 'Mã giao dịch
  // thực tế đã được ghi nhận trên tài khoản này' (owner firsthand 27/11).
  test('mã giao dịch xoay theo đợt: đợt 1 mã gốc, đợt 2/3 hậu tố -2/-3', () => {
    assert.equal(depositRefundPhysicalReference(billRow, 1), 'HOAN-CUOC-42-JH202609258');
    assert.equal(depositRefundPhysicalReference(billRow, 2), 'HOAN-CUOC-42-JH202609258-2');
    assert.equal(depositRefundPhysicalReference(billRow, 3), 'HOAN-CUOC-42-JH202609258-3');
    assert.equal(
      depositRefundTreasuryMovement(3, billRow, 1_500_000, 100, 5, '2026-11-27', 2).physicalReference,
      'HOAN-CUOC-42-JH202609258-2',
      'movement payload đợt 2 dùng mã xoay',
    );
  });
});

describe('resolveRecoveryEdit — hộp Cập nhật hoàn cược (SIL-1061)', () => {
  const editable = (overrides: Partial<Parameters<typeof resolveRecoveryEdit>[0]> = {}) => ({
    status: 'CHUA_HOAN_CUOC' as const,
    depositAmount: '2000000',
    recoveredAmount: null as string | null,
    refundReceivedDate: null as string | null,
    refundPostedMovementId: null as number | null,
    ...overrides,
  });

  test('ghi số đã hoàn từng phần + ngày nhận', () => {
    const plan = resolveRecoveryEdit(editable(), { recoveredAmount: 500_000, refundReceivedDate: '2026-11-20' }, 2_000_000);
    assert.deepEqual(plan, { recoveredAmount: '500000', refundReceivedDate: '2026-11-20', status: 'CHUA_HOAN_CUOC' });
  });

  test('đủ số cược → trạng thái ĐÃ hoàn cược', () => {
    const plan = resolveRecoveryEdit(editable({ recoveredAmount: '500000', refundReceivedDate: '2026-11-20' }), { recoveredAmount: 2_000_000, refundReceivedDate: '2026-11-25' }, 2_000_000);
    assert.equal(plan.status, 'DA_HOAN_CUOC');
  });

  test('vượt số cược (kể cả khi số tiền cược bị sửa giảm cùng lúc) → 400', () => {
    assert.equal(httpStatus(() => resolveRecoveryEdit(editable({ recoveredAmount: '500000' }), {}, 400_000)), 400);
    assert.equal(httpStatus(() => resolveRecoveryEdit(editable(), { recoveredAmount: '3000000' }, 2_000_000)), 400);
  });

  test('đã hoàn > 0 mà không có ngày nhận (thiếu hoặc bị xóa cùng lúc) → 400', () => {
    assert.equal(httpStatus(() => resolveRecoveryEdit(editable(), { recoveredAmount: '500000', refundReceivedDate: null }, 2_000_000)), 400);
    assert.equal(httpStatus(() => resolveRecoveryEdit(editable({ recoveredAmount: '500000', refundReceivedDate: '2026-11-20' }), { refundReceivedDate: null }, 2_000_000)), 400);
  });

  test('không thể giảm số đã hoàn sau khi bút toán quỹ đã chạy → 400', () => {
    assert.equal(httpStatus(() => resolveRecoveryEdit(
      editable({ recoveredAmount: '500000', refundPostedMovementId: 9 }),
      { recoveredAmount: 400_000, refundReceivedDate: '2026-11-20' }, 2_000_000,
    )), 400);
  });

  test('undefined giữ nguyên giá trị đã lưu', () => {
    const plan = resolveRecoveryEdit(editable({ recoveredAmount: '500000', refundReceivedDate: '2026-11-20' }), {}, 2_000_000);
    assert.deepEqual(plan, { recoveredAmount: '500000', refundReceivedDate: '2026-11-20', status: 'CHUA_HOAN_CUOC' });
  });
});

describe('depositRemaining — số còn lại cho cảnh báo + UI (SIL-1061)', () => {
  test('cược − đã hoàn, không âm; dòng cũ không cột = đủ số cược', () => {
    assert.equal(depositRemaining({ depositAmount: '2000000', recoveredAmount: '500000' }), 1_500_000);
    assert.equal(depositRemaining({ depositAmount: '2000000', recoveredAmount: '2000000' }), 0);
    assert.equal(depositRemaining({ depositAmount: '2000000', recoveredAmount: null }), 2_000_000);
  });
});

// SIL-1061 §4 — sau khi hoàn được từng phần, MỌI mặt tiền của hoàn cược phải
// đọc cùng một luật: tiền ĐÃ VỀ = số đã hoàn; tiền CÒN NỢ = số cược − đã hoàn.
// Trước đây hai mặt đọc TRẠNG THÁI dòng (DA_HOAN_CUOC / CHUA_HOAN_CUOC) nên
// một lô hoàn một phần bị cộng trọn số cược ở cảnh báo quỹ và biến mất khỏi
// series "Đã hoàn cược" của biểu đồ tuần — hai mặt không còn trùng bảng.
describe('depositReceived / unrefundedDepositsTotal — hai mặt tiền dùng chung một luật (SIL-1061 §4)', () => {
  test('tiền đã về = số đã hoàn; dòng legacy đã hoàn cược trọn = trọn số cược', () => {
    assert.equal(depositReceived({ status: 'CHUA_HOAN_CUOC', depositAmount: '2000000', recoveredAmount: '500000' }), 500_000);
    assert.equal(depositReceived({ status: 'CHUA_HOAN_CUOC', depositAmount: '2000000', recoveredAmount: null }), 0);
    assert.equal(depositReceived({ status: 'DA_HOAN_CUOC', depositAmount: '2000000', recoveredAmount: '2000000' }), 2_000_000);
    assert.equal(depositReceived({ status: 'DA_HOAN_CUOC', depositAmount: '2000000', recoveredAmount: null }), 2_000_000);
  });

  test('card 370 R4 — cảnh báo "Container chưa hoàn cược" = banner bảng theo dõi hoàn cược', () => {
    // Lô hoàn một phần (còn 1.500.000) + lô chưa hoàn gì (còn 4.000.000).
    assert.equal(unrefundedDepositsTotal([
      { depositAmount: '2000000', recoveredAmount: '500000' },
      { depositAmount: '4000000', recoveredAmount: null },
    ]), 5_500_000);
    assert.equal(unrefundedDepositsTotal([{ depositAmount: '2000000', recoveredAmount: '2000000' }]), 0);
  });
});

describe('computeDepositWeeks — series "Đã hoàn cược" là tiền ĐÃ VỀ (SIL-1061 §4)', () => {
  const source = (overrides: Partial<DepositWeeklySourceRow> = {}): DepositWeeklySourceRow => ({
    createdAt: new Date('2026-11-17T00:00:00.000Z'),
    depositAmount: '2000000',
    recoveredAmount: null,
    status: 'CHUA_HOAN_CUOC',
    refundPostedAt: null,
    updatedAt: new Date('2026-11-17T00:00:00.000Z'),
    ...overrides,
  });
  // Tuần 16/11/2026 (Thứ Hai) → 22/11/2026 (Chủ Nhật).
  const WEEK = { from: '2026-11-16', to: '2026-11-22' };

  test('lô hoàn từng phần: tuần có tiền về = số đã hoàn (không phải 0, không phải trọn số cược)', () => {
    const summary = computeDepositWeeks([
      source({ recoveredAmount: '500000', refundPostedAt: new Date('2026-11-20T03:00:00.000Z') }),
    ], WEEK.from, WEEK.to);
    assert.equal(summary.weeks.length, 1);
    assert.equal(summary.weeks[0]!.weekStart, '2026-11-16');
    assert.equal(summary.weeks[0]!.refundedAmount, 500_000);
    assert.equal(summary.totals.refundedAmount, 500_000);
    // Series "tiền cược" vẫn là trọn số cược, không đổi theo đợt hoàn.
    assert.equal(summary.weeks[0]!.depositAmount, 2_000_000);
    assert.equal(summary.weeks[0]!.count, 1);
  });

  test('lô chưa hoàn gì: không có tiền về trong tuần', () => {
    const summary = computeDepositWeeks([source()], WEEK.from, WEEK.to);
    assert.equal(summary.weeks[0]!.refundedAmount, 0);
  });

  test('dòng legacy (chưa có cột đã hoàn) đã hoàn cược trọn vẫn tính trọn số cược', () => {
    const summary = computeDepositWeeks([
      source({ status: 'DA_HOAN_CUOC', refundPostedAt: new Date('2026-11-20T03:00:00.000Z') }),
    ], WEEK.from, WEEK.to);
    assert.equal(summary.weeks[0]!.refundedAmount, 2_000_000);
  });

  test('tiền về ngoài kỳ không vào series', () => {
    const summary = computeDepositWeeks([
      source({ recoveredAmount: '500000', refundPostedAt: new Date('2026-12-01T03:00:00.000Z') }),
    ], WEEK.from, WEEK.to);
    assert.equal(summary.weeks[0]!.refundedAmount, 0);
    assert.equal(summary.totals.refundedAmount, 0);
  });
});
